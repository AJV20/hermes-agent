import base64
import hashlib
import json
import threading
import uuid
from pathlib import Path

from tui_gateway import server


def _result(response):
    assert "error" not in response, response
    return response["result"]


def _stage(server_home, *, operation_id, attachment_id, payload=b"hello", filename="notes.txt", mime_type="text/plain"):
    data = base64.b64encode(payload).decode("ascii")
    return server._methods["attachment.stage"](
        1,
        {
            "attachment_id": attachment_id,
            "data_url": f"data:{mime_type};base64,{data}",
            "filename": filename,
            "mime_type": mime_type,
            "mobile_operation_id": operation_id,
        },
    )


def test_stage_is_sessionless_idempotent_and_discardable(monkeypatch, tmp_path):
    monkeypatch.setattr(server, "_hermes_home", tmp_path)
    operation_id = str(uuid.uuid4())
    attachment_id = str(uuid.uuid4())

    first = _result(_stage(tmp_path, operation_id=operation_id, attachment_id=attachment_id))
    second = _result(_stage(tmp_path, operation_id=operation_id, attachment_id=attachment_id))

    assert first == second
    assert first["staged"] is True
    assert not server._sessions
    discarded = _result(server._methods["attachment.discard"](2, {
        "attachment_id": attachment_id,
        "mobile_operation_id": operation_id,
        "stage_ref": first["stage_ref"],
    }))
    assert discarded["discarded"] is True
    discarded_dir = tmp_path / "mobile-attachment-staging" / operation_id / attachment_id
    assert not (discarded_dir / "payload.bin").exists()
    assert not (discarded_dir / "metadata.json").exists()


def test_consume_binds_exact_operation_to_session_and_is_idempotent(monkeypatch, tmp_path):
    monkeypatch.setattr(server, "_hermes_home", tmp_path)
    operation_id = str(uuid.uuid4())
    attachment_id = str(uuid.uuid4())
    staged = _result(_stage(tmp_path, operation_id=operation_id, attachment_id=attachment_id))
    sid = "runtime-mobile-stage"
    server._sessions[sid] = {
        "attached_images": [],
        "history_lock": __import__("threading").RLock(),
        "profile_home": str(tmp_path),
        "session_key": "stored-mobile-stage",
    }
    params = {
        "mobile_operation_id": operation_id,
        "session_id": sid,
        "stage_refs": [staged["stage_ref"]],
    }
    try:
        first = _result(server._methods["attachment.consume"](3, params))
        second = _result(server._methods["attachment.consume"](4, params))
    finally:
        server._sessions.pop(sid, None)

    assert first == second
    assert len(first["consumed"]) == 1
    assert first["consumed"][0]["kind"] == "file"
    assert first["consumed"][0]["ref_text"].startswith("@file:")


def test_consume_rejects_operation_mismatch(monkeypatch, tmp_path):
    monkeypatch.setattr(server, "_hermes_home", tmp_path)
    operation_id = str(uuid.uuid4())
    attachment_id = str(uuid.uuid4())
    staged = _result(_stage(tmp_path, operation_id=operation_id, attachment_id=attachment_id))
    sid = "runtime-mobile-stage-mismatch"
    server._sessions[sid] = {
        "attached_images": [],
        "history_lock": __import__("threading").RLock(),
        "profile_home": str(tmp_path),
        "session_key": "stored-mobile-stage-mismatch",
    }
    try:
        response = server._methods["attachment.consume"](5, {
            "mobile_operation_id": str(uuid.uuid4()),
            "session_id": sid,
            "stage_refs": [staged["stage_ref"]],
        })
    finally:
        server._sessions.pop(sid, None)

    assert response["error"]["code"] == 4091


def test_image_consume_queues_once_and_profile_mismatch_is_rejected(monkeypatch, tmp_path):
    home_a = tmp_path / "a"
    home_b = tmp_path / "b"
    home_a.mkdir()
    home_b.mkdir()
    monkeypatch.setattr(server, "_hermes_home", home_a)
    monkeypatch.setattr(server, "_profile_home", lambda profile: home_a if profile == "a" else home_b if profile == "b" else None)
    operation_id = str(uuid.uuid4())
    attachment_id = str(uuid.uuid4())
    staged = _result(_stage(
        home_a,
        operation_id=operation_id,
        attachment_id=attachment_id,
        payload=b"\x89PNG\r\n\x1a\n" + b"0" * 32,
        filename="photo.png",
        mime_type="image/png",
    ))
    sid = "runtime-mobile-stage-image"
    session = {
        "attached_images": [],
        "history_lock": __import__("threading").RLock(),
        "profile_home": str(home_a),
        "session_key": "stored-mobile-stage-image",
    }
    server._sessions[sid] = session
    params = {
        "mobile_operation_id": operation_id,
        "profile": "a",
        "session_id": sid,
        "stage_refs": [staged["stage_ref"]],
    }
    try:
        first = _result(server._methods["attachment.consume"](6, params))
        session["attached_images"].clear()
        second = _result(server._methods["attachment.consume"](7, params))
        mismatch = server._methods["attachment.consume"](8, {**params, "profile": "b"})
    finally:
        server._sessions.pop(sid, None)

    assert first == second
    assert first["consumed"][0]["kind"] == "image"
    assert len(session["attached_images"]) == 1
    assert mismatch["error"]["code"] == 4031


def test_atomic_publish_never_pairs_payload_with_another_writers_metadata(tmp_path):
    stage_dir = tmp_path / "stage"
    payload_path = stage_dir / "payload.bin"
    metadata_path = stage_dir / "metadata.json"
    barrier = threading.Barrier(2)
    outcomes = []

    def writer(payload: bytes):
        metadata = {"sha256": hashlib.sha256(payload).hexdigest(), "version": 1}
        barrier.wait()
        try:
            outcomes.append(("ok", server._mobile_stage_publish(payload_path, metadata_path, payload, metadata)))
        except FileExistsError:
            outcomes.append(("conflict", None))

    threads = [threading.Thread(target=writer, args=(b"A",)), threading.Thread(target=writer, args=(b"B",))]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=5)

    assert [kind for kind, _ in outcomes].count("ok") == 1
    assert [kind for kind, _ in outcomes].count("conflict") == 1
    saved = payload_path.read_bytes()
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    assert metadata["sha256"] == hashlib.sha256(saved).hexdigest()


def test_atomic_consume_allows_only_one_session_visible_side_effect(tmp_path):
    stage_dir = tmp_path / "stage"
    payload_path = stage_dir / "payload.bin"
    metadata_path = stage_dir / "metadata.json"
    payload = b"private"
    server._mobile_stage_publish(
        payload_path,
        metadata_path,
        payload,
        {"sha256": hashlib.sha256(payload).hexdigest(), "version": 1},
    )
    barrier = threading.Barrier(2)
    effects = []
    outcomes = []

    def consume(session_identity: str):
        barrier.wait()
        try:
            result = server._mobile_stage_consume_locked(
                payload_path,
                metadata_path,
                session_identity,
                lambda raw, _metadata: effects.append((session_identity, raw)) or {"kind": "file", "session": session_identity},
            )
            outcomes.append(("ok", result))
        except PermissionError:
            outcomes.append(("conflict", None))

    threads = [threading.Thread(target=consume, args=("session-a",)), threading.Thread(target=consume, args=("session-b",))]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=5)

    assert [kind for kind, _ in outcomes].count("ok") == 1
    assert [kind for kind, _ in outcomes].count("conflict") == 1
    assert len(effects) == 1


def test_prune_removes_expired_stage_payloads_but_keeps_fresh_stages(tmp_path):
    root = tmp_path / "mobile-attachment-staging"
    stale_payload = root / str(uuid.uuid4()) / str(uuid.uuid4()) / "payload.bin"
    fresh_payload = root / str(uuid.uuid4()) / str(uuid.uuid4()) / "payload.bin"
    for path, created_at in ((stale_payload, 10.0), (fresh_payload, 95.0)):
        payload = path.name.encode()
        server._mobile_stage_publish(
            path,
            path.with_name("metadata.json"),
            payload,
            {"created_at": created_at, "sha256": hashlib.sha256(payload).hexdigest(), "version": 1},
        )

    removed = server._mobile_prune_stages(tmp_path, now=100.0, max_age_seconds=20.0)

    assert removed == 1
    assert not stale_payload.exists()
    assert fresh_payload.exists()


def test_bounded_pruning_rotates_past_fresh_prefix_to_expired_stage(
    monkeypatch, tmp_path
):
    root = tmp_path / "mobile-attachment-staging"
    fresh_dirs = []
    for index in range(256):
        stage_dir = root / f"fresh-{index:03d}" / str(uuid.uuid4())
        stage_dir.mkdir(parents=True)
        (stage_dir / "payload.bin").write_bytes(b"fresh")
        (stage_dir / "metadata.json").write_text(
            json.dumps({"created_at": 95.0}), encoding="utf-8"
        )
        fresh_dirs.append(stage_dir)
    stale_dir = root / "stale" / str(uuid.uuid4())
    stale_dir.mkdir(parents=True)
    stale_payload = stale_dir / "payload.bin"
    stale_payload.write_bytes(b"stale")
    (stale_dir / "metadata.json").write_text(
        json.dumps({"created_at": 1.0}), encoding="utf-8"
    )

    original_glob = Path.glob

    def ordered_glob(path, pattern):
        if path == root and pattern == "*/*":
            return iter([*fresh_dirs, stale_dir])
        return original_glob(path, pattern)

    monkeypatch.setattr(Path, "glob", ordered_glob)

    first = server._mobile_prune_stages(
        tmp_path, now=100.0, max_age_seconds=20.0
    )
    second = server._mobile_prune_stages(
        tmp_path, now=100.0, max_age_seconds=20.0
    )

    assert first == 0
    assert second == 1
    assert not stale_payload.exists()
    assert all((stage_dir / "payload.bin").exists() for stage_dir in fresh_dirs)


def test_pruning_uses_stable_cursor_key_when_enumeration_order_changes(
    monkeypatch, tmp_path
):
    root = tmp_path / "mobile-attachment-staging"
    fresh_dirs = []
    for index in range(256):
        stage_dir = root / f"fresh-{index:03d}" / str(uuid.uuid4())
        stage_dir.mkdir(parents=True)
        (stage_dir / "payload.bin").write_bytes(b"fresh")
        (stage_dir / "metadata.json").write_text(
            json.dumps({"created_at": 95.0}), encoding="utf-8"
        )
        fresh_dirs.append(stage_dir)
    stale_dir = root / "stale" / str(uuid.uuid4())
    stale_dir.mkdir(parents=True)
    stale_payload = stale_dir / "payload.bin"
    stale_payload.write_bytes(b"stale")
    (stale_dir / "metadata.json").write_text(
        json.dumps({"created_at": 1.0}), encoding="utf-8"
    )

    original_glob = Path.glob
    call_count = 0

    def reordered_glob(path, pattern):
        nonlocal call_count
        if path == root and pattern == "*/*":
            omitted_index = (256 - call_count) % 257
            reordered = list(fresh_dirs)
            reordered.insert(omitted_index, stale_dir)
            call_count += 1
            return iter(reordered)
        return original_glob(path, pattern)

    monkeypatch.setattr(Path, "glob", reordered_glob)

    removed = [
        server._mobile_prune_stages(
            tmp_path, now=100.0, max_age_seconds=20.0
        )
        for _ in range(4)
    ]

    assert sum(removed) == 1
    assert not stale_payload.exists()
    assert all((stage_dir / "payload.bin").exists() for stage_dir in fresh_dirs)


def test_background_cleanup_expires_abandoned_profile_stage_without_another_rpc(
    monkeypatch, tmp_path
):
    default_home = tmp_path / "default"
    profile_home = default_home / "profiles" / "mabel"
    stale_payload = (
        profile_home
        / "mobile-attachment-staging"
        / str(uuid.uuid4())
        / str(uuid.uuid4())
        / "payload.bin"
    )
    payload = b"abandoned-private-bytes"
    server._mobile_stage_publish(
        stale_payload,
        stale_payload.with_name("metadata.json"),
        payload,
        {
            "created_at": 1.0,
            "sha256": hashlib.sha256(payload).hexdigest(),
            "version": 1,
        },
    )
    monkeypatch.setattr(server, "_hermes_home", default_home)
    monkeypatch.setattr(
        "hermes_cli.profiles.get_profile_dir",
        lambda name: default_home if name == "default" else profile_home,
    )

    removed = server._mobile_prune_all_profile_stages(
        now=100.0, max_age_seconds=20.0
    )

    assert removed == 1
    assert not stale_payload.exists()


def test_locked_discard_cannot_remove_a_consumed_stage(tmp_path):
    payload_path = tmp_path / "stage" / "payload.bin"
    metadata_path = payload_path.with_name("metadata.json")
    payload = b"claimed"
    server._mobile_stage_publish(
        payload_path,
        metadata_path,
        payload,
        {"created_at": 1.0, "sha256": hashlib.sha256(payload).hexdigest(), "version": 1},
    )
    server._mobile_stage_consume_locked(
        payload_path,
        metadata_path,
        "session-a",
        lambda _raw, _metadata: {"kind": "file"},
    )

    try:
        server._mobile_stage_discard_locked(payload_path, metadata_path)
    except PermissionError:
        pass
    else:
        raise AssertionError("consumed stage was discarded")
    assert payload_path.exists()
