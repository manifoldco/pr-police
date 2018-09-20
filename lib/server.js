const Slackbot = require('slackbots');
const pullhub = require('pullhub');
const moment = require('moment');
const messages = require('./messages');
const { isDirectMessage, isBotMessage, isMessage, isBotCommand } = require('./helpers');

module.exports = function server() {
  const env = process.env;
  const requiredEnvs = ['SLACK_TOKEN', 'GH_TOKEN', 'GH_REPOS'];

  if (!requiredEnvs.every(k => !!env[k])) {
    throw new Error('Missing one of this required ENV vars: ' + requiredEnvs.join(','));
  }
  const channels = env.SLACK_CHANNELS ? env.SLACK_CHANNELS.split(',') : [];
  const daysToRun = env.DAYS_TO_RUN || 'Monday,Tuesday,Wednesday,Thursday,Friday';
  const timesToRun = env.TIMES_TO_RUN ? env.TIMES_TO_RUN.split(',') : [900];
  const DEBUG = env.DEBUG || false;
  const groups = env.SLACK_GROUPS ? env.SLACK_GROUPS.split(',') : [];
  const repos = env.GH_REPOS ? env.GH_REPOS.split(',') : [];
  const excludeLabels = env.GH_EXCLUDE_LABELS ? env.GH_EXCLUDE_LABELS.split(',') : [];
  const labels = env.GH_LABELS;
  const blockedLabel = env.GH_BLOCKED_LABEL;
  const wipLabel = env.GH_WIP_LABEL;
  const checkInterval = 60000; // Run every minute (60000)
  const botParams = { icon_url: env.SLACK_BOT_ICON };

  const bot = new Slackbot({
    token: env.SLACK_TOKEN,
    name: env.SLACK_BOT_NAME || 'Pr. Police',
  });

  bot.on('start', () => {
    setInterval(() => {
      const now = moment();
      // Check to see if current day and time are the correct time to run
      if (daysToRun.toLowerCase().indexOf(now.format('dddd').toLowerCase()) !== -1) {
        for (var i = timesToRun.length; i--; ) {
          if (parseInt(timesToRun[i]) === parseInt(now.format('kmm'))) {
            console.log(now.format('dddd YYYY-DD-MM h:mm a'));

            getPullRequests()
              .then(buildMessage)
              .then(notifyAllChannels);
            return;
          } else {
            if (i === 0) {
              DEBUG &&
                console.log(
                  now.format('kmm'),
                  'does not match any TIMES_TO_RUN (' + timesToRun + ')'
                );
            }
          }
        }
      } else {
        DEBUG &&
          console.log(now.format('dddd'), 'is not listed in DAYS_TO_RUN (' + daysToRun + ')');
      }
    }, checkInterval);
  });

  bot.on('message', data => {
    if ((isMessage(data) && isBotCommand(data)) || (isDirectMessage(data) && !isBotMessage(data))) {
      getPullRequests()
        .then(buildMessage)
        .then(message => {
          bot.postMessage(data.channel, message, botParams);
        });
    }
  });

  bot.on('error', err => {
    console.error(err);
  });

  function getPullRequests() {
    console.log('Checking for pull requests…');

    return pullhub(repos, labels).catch(err => {
      console.error(err);
    });
  }

  function buildMessage(data) {
    if (!data) return Promise.resolve(messages.GITHUB_ERROR);

    const hasLabel = (PR, label) => PR.labels.some(({ name }) => name === label);

    let blocked = [];
    let needReview = [];
    let inProgress = [];

    const whitelisted = data.filter(
      ({ labels }) => !labels.some(({ name }) => excludeLabels.indexOf(name) >= 0)
    );

    whitelisted.forEach(PR => {
      if (hasLabel(PR, blockedLabel)) return blocked.push(PR);
      if (hasLabel(PR, wipLabel)) return inProgress.push(PR);
      return needReview.push(PR);
    });

    if (blocked.length || needReview.length || inProgress.length) {
      const format = PR => `‣ [${PR.user.login}] <${PR.html_url}|${PR.number}>: ${PR.title}`;

      let message = [];

      if (blocked.length)
        message = [
          ...message,
          messages.PR_LIST_BLOCKED.replace(/\${NUMBER}/, blocked.length),
          ...blocked.map(PR => format(PR)).sort(),
        ];

      if (needReview.length)
        message = [
          ...message,
          messages.PR_LIST_REVIEW.replace(/\${NUMBER}/, needReview.length),
          ...needReview.map(PR => format(PR)).sort(),
        ];

      /* dangodev: hide In-progress—it’s just noisy (20/9/18)
      if (inProgress.length)
        message = [
          ...message,
          messages.PR_LIST_WIP.replace(/\${NUMBER}/, inProgress.length),
          ...inProgress.map(PR => format(PR)).sort(),
        ];
        */

      return Promise.resolve(message.join('\n'));
    }
  }

  function notifyAllChannels(message) {
    channels.map(channel => {
      bot.postMessageToChannel(channel, message, botParams);
    });

    groups.map(group => {
      bot.postMessageToGroup(group, message, botParams);
    });
  }
};
