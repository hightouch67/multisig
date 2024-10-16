require('dotenv').config()
const { createPublishTx, sendTx } = require('./utils');

process.on('uncaughtException', err => {
    console.error('Uncaught exception', err);
});

let lastHour = 0;
let isProcessing = false;
const account = process.env.ACCOUNT
const multisigAccounts = process.env.MULTISIG_ACCOUNTS.split(' ')
const isLastAccount = multisigAccounts.indexOf(account) === multisigAccounts.length - 1

const check = setInterval(() => {
    if (!isProcessing) {
        const currentHour = new Date().getUTCHours();
        const currentMinutes = new Date().getMinutes();
        console.log('...', currentHour, currentMinutes);
        if (currentHour !== lastHour) {
            isProcessing = true;
            console.log('1/2 Start process', currentHour);
            if (isLastAccount && currentMinutes > 4) {
                sendTx(multisigAccounts[multisigAccounts.indexOf(account) - 1]).then((tx) => {
                    lastHour = currentHour;
                    isProcessing = false;
                    console.log('Tx ', tx);
                    console.log('2/2 Last tx sent at', lastHour);
                })
            }
            else if(!isLastAccount)
                createPublishTx().then((tx) => {
                    lastHour = currentHour;
                    lastTx = tx;
                    isProcessing = false;
                    console.log('Tx ', tx);
                    console.log('2/2 Last signature sent at', lastHour);
                })
        }
    }
}, 1000 * 5);