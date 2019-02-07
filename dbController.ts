import * as getLogger from "loggy";
import { getDB } from "@utils/db";
import { INullableHashMap } from "@sb-types/Types";
import { GuildMember } from "discord.js";
import { EventEmitter } from "events";

export const DEFAULT_TABLE_NAME = "verify";

const TABLE_NAME = Symbol("tableName");
const INITIALIZED = Symbol("isInitialized");
const LOGGER = Symbol("log");
const LOCAL_CACHE = Symbol("localCache");

const DB = getDB();

/**
 * Gets local storage key for the member
 * @param member Member of the server
 */
function getLocalStorageKey(member: GuildMember) {
	return `${member.guild.id}:${member.id}`;
}

function mustBeInitialized(controller: VerifyDBController) {
	if (!controller[INITIALIZED]) {
		throw new Error("The controller must be initialized first!");
	}
}

interface IVerifyData {
	/**
	 * ID of the server
	 */
	guildId: string;
	/**
	 * ID of the server member
	 */
	memberId: string;
	/**
	 * Passed verification level
	 */
	level: VerificationLevel;
}

export class VerifyDBController extends EventEmitter {
	/**
	 * Database table name
	 */
	private readonly [TABLE_NAME]: string;

	/**
	 * Initialization indication
	 */
	private [INITIALIZED]: boolean;

	/**
	 * The logger to log anything that needs to be logged, y'know?
	 */
	private readonly [LOGGER]: getLogger.ILogFunction;

	/**
	 * The local cache of all verifications
	 */
	private readonly [LOCAL_CACHE]: INullableHashMap<number>;

	/**
	 * Gets table name
	 * @returns Currently used table name
	 */
	public getTableName() {
		return this[TABLE_NAME];
	}

	/**
	 * Checks whether this controller was initialized
	 * @returns `true` if controller initialized, otherwise `false`
	 */
	public isInitialized() {
		return this[INITIALIZED];
	}

	constructor(tableName = DEFAULT_TABLE_NAME) {
		super();

		this[TABLE_NAME] = tableName;
		this[LOGGER] = getLogger(`Verify:DB{${tableName}}`);
		this[INITIALIZED] = false;
		this[LOCAL_CACHE] = Object.create(null);
	}

	/**
	 * Initializes the module
	 */
	public async init() {
		if (this[INITIALIZED]) {
			throw new Error("The controller is already initialized");
		}

		const log = this[LOGGER];
		const tableName = this[TABLE_NAME];

		if (!(DB.schema.hasTable(tableName))) {
			log("verb", `No table with name "${tableName}" found. Creating...`);

			try {
				await DB.schema.createTable(tableName, (tb) => {
					tb.string("guildId").notNullable();
					tb.string("memberId").notNullable();
					tb.integer("level").notNullable().defaultTo(0);
				});
			} catch (err) {
				log("err", "Unable to create table, an error has occured");

				throw err;
			}

			log("ok", `Table "${tableName}" created`);
		} else {
			log("ok", `Found table "${tableName}"`);
		}

		this[INITIALIZED] = true;
	}

	private _checkInLocalStorage(key: string) {
		return this[LOCAL_CACHE][key];
	}

	private _storeLocally(key: string, level: VerificationLevel) {
		this[LOCAL_CACHE][key] = level;
	}

	/**
	 * Gets **guessed** verification level member has passed according to bot
	 * @param member Member of the server whose level to check
	 * @returns **Guessed** passed verification level
	 */
	public async getVerificationLevel(member: GuildMember) : Promise<VerificationLevel> {
		mustBeInitialized(this);

		// Guilds may have verification disabled
		if (member.guild.verificationLevel === 0) return VerificationLevel.NONE;

		// By default members have only one hidden role (@everyone)
		if (member.roles.size > 1) return VerificationLevel.SKIPPED;

		const localKey = getLocalStorageKey(member);
		const localValue = this._checkInLocalStorage(localKey);

		if (localValue != null) return localValue;

		const dbData = <IVerifyData | null> await DB(this[TABLE_NAME]).where({
			guildId: member.guild.id,
			memberId: member.id,
		}).first();

		if (dbData !== null) {
			const { level } = dbData;

			this._storeLocally(localKey, level);

			return level;
		}

		this.storeLevel(member, 0);

		return 0;
	}

	/**
	 * Gets member verification level
	 * @param member Member of the server whose level to store
	 * @param level Guessed passed verification level
	 */
	public async storeLevel(member: GuildMember, level: VerificationLevel) {
		mustBeInitialized(this);

		if (level === VerificationLevel.SKIPPED) {
			throw new Error("Verification level of 5 means the verification has been skipped by using a role. This value must not be stored in the database");
		}

		await DB(this[TABLE_NAME]).insert(<IVerifyData> {
			guildId: member.guild.id,
			memberId: member.id,
			level
		});

		this._storeLocally(getLocalStorageKey(member), level);

		if (member.guild.verificationLevel === level) {
			this.emit("verified", member, level);
		}
	}

	/**
	 * Purges member's verification level from the local storage and table
	 * @param member Member of the server whose level to delete
	 */
	public async purgeLevel(member: GuildMember) {
		mustBeInitialized(this);

		await DB(this[TABLE_NAME]).where(<IVerifyData> {
			guildId: member.guild.id,
			memberId: member.id
		}).delete();

		delete this[LOCAL_CACHE][getLocalStorageKey(member)];

		this.emit("purged", member);
	}
}

export default VerifyDBController;
