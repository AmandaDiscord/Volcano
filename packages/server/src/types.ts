export type UnpackRecord<T> = T extends Record<any, infer R> ? R : never;
