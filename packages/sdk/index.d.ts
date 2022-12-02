import { Plugin, LavaLinkConfig, Logger, ThreadPool } from "./types";
export { Plugin };

declare global {
	var lavalinkConfig: RequiredObjectDeep<LavaLinkConfig>;
	var lavalinkDirname: string;
	var lavalinkPlugins: Array<Plugin>;
	var lavalinkSources: Set<Plugin>;
	var lavalinkRootLog: Logger["info"];
	var lavalinkLog: Logger["info"];
	var lavalinkVersion: string;
	var lavalinkMajor: string;
	var lavalinkThreadPool: ThreadPool;

	export type RequiredDeep<T, E extends Exclude<T, undefined> = Exclude<T, undefined>> = E extends string | number | symbol | bigint | boolean | null | undefined | Date | RegExp
			? E
			: E extends Map<infer KeyType, infer ValueType>
					? Map<RequiredDeep<KeyType>, RequiredDeep<ValueType>>
					: E extends Set<infer ItemType>
							? Set<RequiredDeep<ItemType>>
							: E extends ReadonlyMap<infer KeyType, infer ValueType>
									? ReadonlyMap<RequiredDeep<KeyType>, RequiredDeep<ValueType>>
									: E extends ReadonlySet<infer ItemType>
											? ReadonlySet<RequiredDeep<ItemType>>
											: E extends (arg: any[]) => unknown
													? E
													: E extends object
															? E extends Array<infer ItemType> // Test for arrays/tuples, per https://github.com/microsoft/TypeScript/issues/35156
																	? ItemType[] extends E // Test for arrays (non-tuples) specifically
																			? Array<RequiredDeep<ItemType>> // Recreate relevant array type to prevent eager evaluation of circular reference
																			: RequiredObjectDeep<E> // Tuples behave properly
																	: RequiredObjectDeep<E>
															: unknown;

	export type RequiredObjectDeep<ObjectType extends object> = {
			[KeyType in keyof ObjectType]-?: RequiredDeep<ObjectType[KeyType]>
	};
}
