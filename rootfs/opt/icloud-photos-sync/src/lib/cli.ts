import {Command, Option, OptionValues} from 'commander';
import chalk from 'chalk';
import {PACKAGE_INFO} from './package.js';
import {iCloud} from './icloud/icloud.js';
import * as ICLOUD from './icloud/constants.js';
import * as SYNC_ENGINE from './sync-engine/constants.js';
import {SyncEngine} from './sync-engine/sync-engine.js';
import {SingleBar} from 'cli-progress';
import {exit} from 'process';

export class CLIInterface {
    progressBar: SingleBar;
    static instance: CLIInterface;

    constructor(iCloud: iCloud, syncEngine: SyncEngine) {
        this.progressBar = new SingleBar({
            etaAsynchronousUpdate: true,
            etaBuffer: 20,
            format: ' {bar} {percentage}% | Elapsed: {duration_formatted} | ETA: {eta_formatted} | {value}/{total}',
            barCompleteChar: '\u25A0',
            barIncompleteChar: ' ',
            linewrap: true
        });
        this.setupCLIiCloudInterface(iCloud);
        this.setupCLISyncEngineInterface(syncEngine);

        process.on(`SIGTERM`, () => {
            console.log(`Received SIGTERM.`);
            process.exit(1)
            // Save photos db
            // stop sync engine
        });

        process.on("SIGINT", () => {
            console.log(`Received SIGINT`)
            process.exit(1)
        })

        console.log(chalk.white.bold(`Welcome to ${PACKAGE_INFO.name}, v.${PACKAGE_INFO.version}!`));
        console.log(chalk.green(`Made with <3 by steilerDev`));
        console.log();
    }

    /**
     * Initiates the CLI interface and connects it to the relevant components
     * @param iCloud - The iCloud object
     * @param photosLibrary - The Photos Library object
     * @param syncEngine - The Sync Engine object
     */
    static createCLIInterface(iCloud: iCloud, syncEngine: SyncEngine) {
        if (!this.instance) {
            this.instance = new CLIInterface(iCloud, syncEngine);
        }
    }

    /**
     * Processing CLI arguments
     * @returns The parsed values from the commandline/environment variables
     */
    static getCLIOptions(): OptionValues {
        const program = new Command();
        program.name(PACKAGE_INFO.name)
            .description(PACKAGE_INFO.description)
            .version(PACKAGE_INFO.version)
            .addOption(new Option(`-u, --username <email>`, `AppleID username`)
                .env(`APPLE_ID_USER`)
                .makeOptionMandatory(true))
            .addOption(new Option(`-p, --password <email>`, `AppleID password`)
                .env(`APPLE_ID_PWD`)
                .makeOptionMandatory(true))
            .addOption(new Option(`-d, --data_dir <string>`, `Directory to store local copy of library`)
                .env(`DATA_DIR`)
                .default(`/opt/icloud-photos-library`))
            .addOption(new Option(`-p, --port <number>`, `port number for MFA server (Awaiting MFA code when necessary)`)
                .env(`PORT`)
                .default(8080))
            .addOption(new Option(`-l, --log_level <level>`, `Set the log level`)
                .env(`LOG_LEVEL`)
                .choices([`trace`, `debug`, `info`, `warn`, `error`])
                .default(`debug`))
            .addOption(new Option(`--log_to_cli`, `Disables logging to file and logs to the console`)
                .env(`LOG_TO_CLI`)
                .default(false))
            .addOption(new Option(`-t, --download_threads <number>`, `Sets the number of download threads`)
                .env(`DOWNLOAD_THREADS`)
                .default(5))
            .addOption(new Option(`-r, --max_retries <number>`, `Sets the number of maximum retries upon an error (-1 means that it will always retry)`)
                .env(`MAX_RETRIES`)
                .default(-1));
        program.parse();
        return program.opts();
    }

    static fatalError(err: string) {
        console.log(chalk.red(`Experienced Fatal Error: ${err}`));
        exit(1);
    }

    /**
     * Listen to iCloud events and provide CLI output
     */
    setupCLIiCloudInterface(iCloud: iCloud) {
        iCloud.on(ICLOUD.EVENTS.AUTHENTICATION_STARTED, () => {
            console.log(chalk.white(`Authenticating user...`));
        });

        iCloud.on(ICLOUD.EVENTS.AUTHENTICATED, () => {
            console.log(chalk.white(`User authenticated`));
        });

        iCloud.on(ICLOUD.EVENTS.MFA_REQUIRED, () => {
            console.log(chalk.yellowBright(`MFA code required, waiting for input`));
        });

        iCloud.on(ICLOUD.EVENTS.MFA_RECEIVED, () => {
            console.log(chalk.white(`MFA code received`));
        });

        iCloud.on(ICLOUD.EVENTS.TRUSTED, () => {
            console.log(chalk.whiteBright(`Device trusted`));
        });

        iCloud.on(ICLOUD.EVENTS.ACCOUNT_READY, () => {
            console.log(chalk.whiteBright(`Sign in successful!`));
        });

        iCloud.on(ICLOUD.EVENTS.READY, () => {
            console.log(chalk.green(`iCloud connection established!`));
        });

        iCloud.on(ICLOUD.EVENTS.ERROR, (msg: string) => {
            console.log(chalk.red(`Unexpected error: ${msg}`));
        });


    }

    setupCLISyncEngineInterface(syncEngine: SyncEngine) {
        syncEngine.on(SYNC_ENGINE.EVENTS.FETCH, () => {
            console.log(chalk.white(`Loading local state & fetching remote iCloud Library state`));
        });
        syncEngine.on(SYNC_ENGINE.EVENTS.DIFF, () => {
            console.log(chalk.white(`Diffing remote with local state`));
        });

        syncEngine.on(SYNC_ENGINE.EVENTS.FETCH_COMPLETED, (localAssetCount, localAlbumCount, remoteAssetCount, remoteAlbumCount) => {
            console.log(chalk.green(`Loaded Local state: ${localAssetCount} assets & ${localAlbumCount} albums`))
            console.log(chalk.green(`Fetched Remote state: ${remoteAssetCount} assets & ${remoteAlbumCount} albums`))
        });

        syncEngine.on(SYNC_ENGINE.EVENTS.WRITE, (toBeDeletedCount, toBeAddedCount) => {
            console.log(chalk.cyan(`Downloading ${toBeAddedCount} remote assets, removing ${toBeDeletedCount} local assets`));
            this.progressBar.start(toBeAddedCount, 0);
        });

        syncEngine.on(SYNC_ENGINE.EVENTS.RECORD_COMPLETED, recordName => {
            //console.log(`Completed ${recordName}`);
            this.progressBar.increment(1, recordName);
        });

        syncEngine.on(SYNC_ENGINE.EVENTS.RETRY, () => {
            this.progressBar.stop()
            console.log(chalk.grey.bold(`Detected recoverable error, retrying...`));
        });

        syncEngine.on(SYNC_ENGINE.EVENTS.APPLY_STRUCTURE, (toBeDeletedCount, toBeAddedCount) => {
            console.log(chalk.cyan(`Applying remote structure to local file system, by adding ${toBeAddedCount} and deleting ${toBeDeletedCount} albums`));
        });

        syncEngine.on(SYNC_ENGINE.EVENTS.DONE, () => {
            console.log(chalk.green.bold(`Sync completed!`));
        });

        syncEngine.on(SYNC_ENGINE.EVENTS.ERROR, (msg) => {
            console.log(chalk.red(`Sync engine: Unexpected error: ${msg}`));
        });
    }
}