/* eslint-disable no-var */
import { Plugin, LavaLinkConfig } from "./types";
export { Plugin };

declare global {
	var lavalinkConfig: RequiredObjectDeep<LavaLinkConfig>;
	var lavalinkDirname: string;
	var lavalinkPlugins: Array<Plugin>;
	var lavalinkSources: Set<Plugin>;
	var lavalinkRootLog: Console["log"];
	var lavalinkLog: Console["log"];
	var lavalinkVersion: string;
	var lavalinkMajor: string;

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

	export type OptionalDeep<T, E extends T = T> = E extends string | number | symbol | bigint | boolean | null | undefined | Date | RegExp
		? E | undefined
		: E extends Map<infer KeyType, infer ValueType>
			? Map<OptionalDeep<KeyType>, OptionalDeep<ValueType>>
			: E extends Set<infer ItemType>
				? Set<OptionalDeep<ItemType>>
				: E extends ReadonlyMap<infer KeyType, infer ValueType>
						? ReadonlyMap<OptionalDeep<KeyType>, OptionalDeep<ValueType>>
						: E extends ReadonlySet<infer ItemType>
								? ReadonlySet<OptionalDeep<ItemType>>
								: E extends (arg: any[]) => unknown
										? E
										: E extends object
												? E extends Array<infer ItemType> // Test for arrays/tuples, per https://github.com/microsoft/TypeScript/issues/35156
														? ItemType[] extends E // Test for arrays (non-tuples) specifically
																? Array<OptionalDeep<ItemType>> // Recreate relevant array type to prevent eager evaluation of circular reference
																: OptionalObjectDeep<E> // Tuples behave properly
														: OptionalObjectDeep<E>
												: unknown;

	export type OptionalObjectDeep<ObjectType extends object> = {
		[KeyType in keyof ObjectType]+?: OptionalDeep<ObjectType[KeyType]>
	};

}
