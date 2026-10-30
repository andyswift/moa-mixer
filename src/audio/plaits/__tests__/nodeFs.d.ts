// The one Node call the Plaits tests make (reading the reference renders); the project has no Node types.
declare module 'node:fs' {
  export function readFileSync(path: URL | string): Uint8Array;
}
