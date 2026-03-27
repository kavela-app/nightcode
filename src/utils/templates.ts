/**
 * Simple template engine: replaces {{variable}} placeholders with values.
 */
export function renderTemplate(
  template: string,
  vars: Record<string, string | undefined>,
): string {
  return template.replace(
    /\{\{(\w+(?:\.\w+)*)\}\}/g,
    (match, path: string) => {
      const value = path
        .split(".")
        .reduce<unknown>(
          (obj, key) =>
            obj && typeof obj === "object"
              ? (obj as Record<string, unknown>)[key]
              : undefined,
          vars,
        );
      return typeof value === "string" ? value : match;
    },
  );
}
