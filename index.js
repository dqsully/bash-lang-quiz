if (!process.stdin.isTTY) {
    process.exit(0);
}

const https = require('https');
const util = require('util');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

const doasync = require('doasync');
const hjson = require('hjson');
const parser = new (require('rss-parser'))();
const a = require('short-ansi')();

function defer() {
    let resolve, reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });

    return {promise, resolve, reject};
}
function onStreamEnd(stream) {
    const {promise, resolve, reject} = defer();

    stream.on('end', resolve);
    stream.on('error', reject);
    
    return promise;
}

https.get[util.promisify.custom] = (options) => {
    const {promise, resolve, reject} = defer();

    const request = https.get(options, resolve);
    request.on('error', reject);

    return {request, response: promise};
}

readline.Interface.prototype.question[util.promisify.custom] = function(query) {
    const {promise, resolve, reject} = defer();

    this.question(query, resolve);
    
    return promise;
}

async function translate({text, from, to}) {
    let {request, response} = await doasync(https).get(
        `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(from)}&tl=${encodeURIComponent(to)}&dt=t&q=${encodeURIComponent(text)}`,
    );

    response = await response;

    let resultText = '';
    response.on('data', (chunk) => resultText += chunk);

    await onStreamEnd(response);

    return JSON.parse(resultText)[0][0][0];
}

function randIndex(length) {
    return Math.floor(Math.random() * length);
}

const {feeds, lang} = hjson.parse(fs.readFileSync(path.join(__dirname, 'options.hjson'), 'utf8'));
async function getHeadline() {
    const feedUrl = feeds[randIndex(feeds.length)];
    const feed = await parser.parseURL(feedUrl);

    const item = feed.items[randIndex(Math.min(100, feed.items.length))];

    return item.title;
}


let correct = 0;
let total = 0;

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

rl.on('SIGINT', () => process.exit(1));

const scorePath = `${__dirname}/bt_score.hjson`;

(async () => {
    console.log(a`\{ld Getting headlines...\}`);
    
    // Get a headline
    const headlineEs = await getHeadline();

    // Start translating the headline using google in the background
    let headlineEsToEn = translate({text: headlineEs, from: lang, to: 'en'});

    // Get the user to translate the headline to English
    const headlineEn = await doasync(rl).question(a`\{g What does this headline mean in English?:\} \{y ${headlineEs}\}\n`);
    
    // Wait for the google translation to finish
    headlineEsToEn = await headlineEsToEn;
    
    // Ask the user if they were correct or not
    let quizResults = await doasync(rl).question(a`\{g Did you write something like this?:\} (Y/n) \{y ${headlineEsToEn}\}\n`);

    console.log(`Results: ${quizResults}`);

    // Load previous scores if there are any
    if (fs.existsSync(scorePath)) {
        ({correct, total} = hjson.parse(fs.readFileSync(scorePath, 'utf8')));
    }

    // Increment correct count if correct
    quizResults = quizResults.toLowerCase();
    if (quizResults == 'y' || quizResults == 'yes' || quizResults == '') {
        correct++;
    }

    // Increment total count
    total++;

    // Log current scores
    const incorrect = total - correct;
    console.log(a`Score: \{g ${correct}\}/\{r ${incorrect}\}/\{c ${total}\}`);

    // Save current scores
    fs.writeFileSync(scorePath, hjson.stringify({correct, total}));
})().catch(console.error).then(() => rl.close());
