import { normalizeEntryBasePath } from "../entry-path";

export function desktopDocumentHref(path: string, basePath: string | undefined): string {
  return `${normalizeEntryBasePath(basePath)}${path}`;
}
