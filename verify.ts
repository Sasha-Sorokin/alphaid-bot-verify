import { IModule } from "@sb-types/ModuleLoader/Interfaces.new";
import { Plugin } from "../plugin";
import * as getLogger from "loggy";
import { VerifyDBController, DEFAULT_TABLE_NAME } from "./dbController";
import { initializationMethod, unloadMethod } from "@sb-types/ModuleLoader/Decorators";
import { ModulePrivateInterface, ConfigFormat } from "@sb-types/ModuleLoader/PrivateInterface";
import * as cfg from "@utils/config";
import { GuildMember, Message } from "discord.js";
import { getMessageMember } from "@utils/utils";

interface IConfigDatabase {
	tableName: string;
}

const CONFIG_PROPS = {
	configName: "database",
	format: ConfigFormat.YAML
};

const DB_CONTROLLER = Symbol("dbController");
const LOGGER = Symbol("logger");

export class Verify extends Plugin implements IModule<Verify> {
	private readonly [LOGGER] = getLogger("Verify");
	private [DB_CONTROLLER]: VerifyDBController;

	constructor() {
		super({
			"message": (msg) => this._onMessage(msg),
			"guildMemberAdd": (member) => this._onMemberJoined(member),
			"guildMemberRemove": (member) => this._onMemberLeft(member)
		}, true);
	}

	@initializationMethod
	public async init(i: ModulePrivateInterface<Verify>) {
		const log = this[LOGGER];

		let config = (await cfg.instant<IConfigDatabase>(i, CONFIG_PROPS))[1];

		if (config == null) {
			config = <IConfigDatabase> { tableName: DEFAULT_TABLE_NAME };

			await cfg.saveInstant<IConfigDatabase>(i, <Required<IConfigDatabase>> config, CONFIG_PROPS);

			log("info", `No database config was in place, new one has been created. Uses table name ${config.tableName}`);
		}

		if (config.tableName == null) throw new Error("Table name must be provided in the config");

		const dbController = new VerifyDBController(config.tableName);

		this[DB_CONTROLLER] = dbController;

		await dbController.init();
	}

	public isEnabled() {
		return this[DB_CONTROLLER].isInitialized();
	}

	private _errorHasOccured(when: string, member: GuildMember, err: any) {
		this[LOGGER]("err", `An error has occured ${when} of member "${member.id}" at "${member.guild.id}":`, err);
	}

	private async _onMessage(message: Message) {
		const guildVerificationLevel = message.guild.verificationLevel;

		if (message.channel.type !== "text" || guildVerificationLevel === 0) return;
		
		const member = await getMessageMember(message);

		if (!member) return;

		try {
			const storedVerification = await this.getVerificationLevel(member);

			const verifiedAlready = storedVerification === VerificationLevel.SKIPPED
				|| storedVerification === message.guild.verificationLevel;

			if (verifiedAlready) return;
		} catch (err) {
			this._errorHasOccured("while checking verification level", member, err);
		}

		try {
			this[DB_CONTROLLER].storeLevel(member, guildVerificationLevel);
		} catch (err) {
			this._errorHasOccured("in attempt to store new verification level", member, err);
		}
	}

	private async _onMemberJoined(member: GuildMember) {
		const controller = this[DB_CONTROLLER];

		if (!controller || !controller.isInitialized()) return;

		try {
			this[DB_CONTROLLER].storeLevel(member, 0);
		} catch (err) {
			this._errorHasOccured("in attempt to store new verification level", member, err);
		}
	}

	private async _onMemberLeft(member: GuildMember) {
		const controller = this[DB_CONTROLLER];

		if (!controller || !controller.isInitialized()) return;

		try {
			this[DB_CONTROLLER].purgeLevel(member);
		} catch (err) {
			this._errorHasOccured("in attempt to purge verification level", member, err);
		}
	}

	/**
	 * Adds an listener to the DBController event that fires once
	 * member has been verified on any of the servers
	 * @param callback Callback to call once member has been verified
	 * @returns Function to remove event listener
	 */
	public onVerified(callback: (member: GuildMember, level: VerificationLevel) => void) {
		this[DB_CONTROLLER].on("verified", callback);

		return () => {
			this[DB_CONTROLLER].removeListener("verified", callback);
		};
	}

	/**
	 * Adds a listener to the DBController event that fires once
	 * member has been purged verified status on any of the servers
	 * @param callback Function to call once member has been purged
	 */
	public onPurged(callback: (member: GuildMember) => void) {
		this[DB_CONTROLLER].on("purged", callback);

		return () => {
			this[DB_CONTROLLER].removeListener("purged", callback);
		};
	}

	/**
	 * Guesses whether member has passed server verification level or not
	 * @param member Member of the server whose level to check
	 */
	public async isVerified(member: GuildMember) {
		const controller = this[DB_CONTROLLER];

		if (!controller || !controller.isInitialized()) return false;

		const guessedVerifyLevel = await controller.getVerificationLevel(member);

		return guessedVerifyLevel >= member.guild.verificationLevel;
	}

	/**
	 * Gets **guessed** verify level of the member
	 * @param member Member of the server whose level to check
	 */
	public getVerificationLevel(member: GuildMember) {
		const controller = this[DB_CONTROLLER];

		if (!controller || !controller.isInitialized()) return false;

		return controller.getVerificationLevel(member);
	}

	@unloadMethod
	public async unload() {
		this._unhandleEvents();

		return true;
	}
}

export default Verify;
