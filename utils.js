require('dotenv').config();
const steem = require('steem');
const multisigAccounts = process.env.MULTISIG_ACCOUNTS.split(' ')
const username = process.env.ACCOUNT;

let cachedBlockProps = {};
let lastFetchedHour = -1;

function getDynamicGlobalProperties() {
    return new Promise((resolve, reject) => {
        steem.api.getDynamicGlobalProperties((err, result) => {
            if (err) {
                reject(err);
            } else {
                resolve(result);
            }
        });
    });
}

async function fetchGlobalProperties() {
    return new Promise((resolve, reject) => {
        steem.api.getDynamicGlobalProperties((err, result) => {
            if (err) {
                reject(err);
            } else {
                resolve(result);
            }
        });
    });
}

async function getRefBlockProps() {
    const currentHour = new Date().getUTCHours();

    // Check if we need to fetch new block properties
    if (currentHour !== lastFetchedHour) {
        try {
            const globalProps = await fetchGlobalProperties();
            const blockProps = {
                ref_block_num: globalProps.head_block_number & 0xFFFF,
                ref_block_prefix: Buffer.from(globalProps.head_block_id, 'hex').readUInt32LE(4),
            };
            cachedBlockProps[currentHour] = blockProps; // Cache the properties by hour
            lastFetchedHour = currentHour;
        } catch (error) {
            console.error('Error fetching global properties:', error);
            throw error; // Rethrow to indicate failure
        }
    }

    return cachedBlockProps[currentHour];
}


function sendTransaction(transaction, privateKey) {
    return new Promise((resolve, reject) => {
        steem.broadcast.send(transaction, privateKey, (err, result) => {
            if (err)
                reject(err);
            resolve(result);
        });
    });
}

function signTransaction(transaction) {
    return  steem.auth.signTransaction(transaction, [process.env.ACTIVE_KEY])
}

function broadcastTransaction(signedTransaction) {
    return new Promise((resolve, reject) => {
        steem.api.broadcastTransaction(signedTransaction, (err, result) => {
            if (err)
                reject(err);
            resolve(result);
        });
    });
}

function getAccounts(accounts) {
    return new Promise((resolve, reject) => {
        steem.api.getAccounts(accounts, (err, result) => {
            if (err)
                reject(err);
            resolve(result);
        });
    });
}

function createPublishTx() {
    return new Promise(async (resolve, reject) => {
        const { ref_block_num, ref_block_prefix } = await getRefBlockProps();

        const transactionData = {
            operations: [
                ['transfer',
                    {
                        amount: `${process.env.AMOUNT_SBD} SBD`,
                        from: process.env.TRANSFER_FROM,
                        memo: process.env.MEMO,
                        to: process.env.SEND_TO
                    }
                ]
            ]
        };
        const nextHourUTC = new Date();
        nextHourUTC.setUTCMinutes(0, 0, 0); 
        nextHourUTC.setUTCHours(nextHourUTC.getUTCHours() + 1);
        let transaction = {
            ref_block_num,
            ref_block_prefix,
            expiration: nextHourUTC.toISOString().slice(0, -5),
            operations: transactionData.operations,
            extensions: []
        };
        const signedTransaction = signTransaction(transaction);
        const [account] = await getAccounts([username])
        let json_metadata;
        try {
            json_metadata = JSON.parse(account.posting_json_metadata)
        } catch (error) {
            console.log(error)
        }
        json_metadata.mtx = signedTransaction.signatures[0]
        let ops = [];
        ops.push(
            [
                'account_update2',
                {
                    account: username,
                    json_metadata: "",
                    posting_json_metadata: JSON.stringify(json_metadata)
                },
            ])
        try {
            const finalTx = { operations: ops, extensions: [] };
            const tx = await sendTransaction(finalTx, { posting: process.env.POSTING_KEY })
            resolve(tx)
        } catch (error) {
            reject(error)
        }
    })
}

async function sendTx() {
    return new Promise(async (resolve, reject) => {
        const accountsToFetch = multisigAccounts.filter(account => account !== username);
        const fromAccounts = await getAccounts(accountsToFetch);
        const signatures = [];

        try {
            // Collect signatures from accounts
            for (const account of fromAccounts) {
                if (account.posting_json_metadata) {
                    const json_metadata = JSON.parse(account.posting_json_metadata);
                    if (json_metadata.mtx) {
                        signatures.push(json_metadata.mtx);
                    } else {
                        throw new Error('Missing mtx in json_metadata for account: ' + account.name);
                    }
                }
            }

            console.log('Collected signatures:', signatures);

            // Get dynamic global properties
            const [ref_block_num, ref_block_prefix] = await getDynamicGlobalProperties();

            // Prepare transaction data
            const transactionData = {
                operations: [
                    ['transfer', {
                        amount: `${process.env.AMOUNT_SBD} SBD`,
                        from: process.env.TRANSFER_FROM,
                        memo: process.env.MEMO,
                        to: process.env.SEND_TO
                    }]
                ]
            };

            // Calculate expiration as the next hour in UTC
            const nextHourUTC = new Date();
            nextHourUTC.setUTCMinutes(0, 0, 0);
            nextHourUTC.setUTCHours(nextHourUTC.getUTCHours() + 1);

            // Create the transaction object
            let transaction = {
                ref_block_num,
                ref_block_prefix,
                expiration: nextHourUTC.toISOString().slice(0, -5), // No 'Z' for expiration
                operations: transactionData.operations,
                extensions: [],
                signatures
            };

            // Sign the transaction
            const signedTransaction = signTransaction(transaction);

            // Add collected signatures to the transaction
            transaction.signatures = signedTransaction.signatures;

            console.log('Signed transaction:', transaction);
            
            // Broadcast the transaction
            const tx = await sendTransaction(transaction);
            resolve(tx);
        } catch (error) {
            console.error('Error while processing transaction:', error);
            reject(error);
        }
    });
}

module.exports = { createPublishTx, sendTx }