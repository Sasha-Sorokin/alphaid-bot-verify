const enum VerificationLevel {
	/**
	 * Has not completed verification
	 */
	NONE = 0,
	/**
	 * Has verified email on their Discord account
	 */
	LOW = 1,
	/**
	 * Registered in Discord for five minutes
	 */
	MEDIUM = 2,
	/**
	 * Anything lower + member of the server for 10 minutes
	 */
	HIGH = 3,
	/**
	 * Verified by phone number
	 */
	HIGHEST = 4,
	/**
	 * Member has been gained a role and has skipped verification
	 * 
	 * This value **must not** be stored in the database
	 */
	SKIPPED = 5
}
