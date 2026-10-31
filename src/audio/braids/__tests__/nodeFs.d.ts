// The Node calls the Braids tests make (whether a reference render is there); the project has no Node types.
declare module 'node:fs' {
  export function existsSync(path: URL | string): boolean;
}
