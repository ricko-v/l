export const DEFAULT_PROFILE = "default";

// Lowercase names avoid aliases on case-insensitive filesystems.
export function isProfileName(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value)
    && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(value);
}

export function resolveProfile(explicit?: string, projectProfile?: string): string {
  const profile = explicit ?? projectProfile ?? DEFAULT_PROFILE;
  if (!isProfileName(profile)) {
    throw new Error("Invalid profile name. Use 1–64 lowercase letters, digits, underscores or hyphens, starting with a letter or digit. Windows device names such as con, nul and com1 are reserved.");
  }
  return profile;
}

export function loginHint(profile: string) {
  return `l login --profile ${resolveProfile(profile)}`;
}
