/**
 * Web app entry point. Deploy this project as a Web App (see README) to get a stable URL
 * for the dashboard - Apps Script runs it on-demand per request, nothing needs to stay
 * "running" in the background.
 */
function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('SDR Manager Dashboard')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
function debugEmailVolume() {
  var ownerIds = getAllOwnerIds();
  var now = new Date();
  var lookbackStart = new Date(now.getTime() - ENGAGEMENT_LOOKBACK_DAYS * 86400000);

  var emails = fetchEngagementsInWindow_('emails', eqFilter(EMAIL_DIRECTION_PROP, EMAIL_DIRECTION_OUTGOING), ownerIds, lookbackStart, now);
  Logger.log('Total emails fetched across ALL SDRs in one query: ' + emails.length);

  var jonathanCount = emails.filter(function (e) { return e.properties[ENGAGEMENT_OWNER_PROP] === '97411438'; }).length;
  Logger.log('Of those, how many belong to Jonathan: ' + jonathanCount);
}
