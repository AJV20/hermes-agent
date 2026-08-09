export function normalizeEntryBasePath(raw: string | undefined): string {
  if (!raw || raw === "/") return "";
  const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withLeadingSlash.replace(/\/+$/, "");
}

export function isMobileEntryPath(pathname: string, basePath: string | undefined): boolean {
  const normalizedBasePath = normalizeEntryBasePath(basePath);
  if (normalizedBasePath && !pathname.startsWith(`${normalizedBasePath}/`)) {
    return false;
  }

  const routePath = normalizedBasePath
    ? pathname.slice(normalizedBasePath.length)
    : pathname;
  return routePath === "/mobile" || routePath.startsWith("/mobile/");
}
