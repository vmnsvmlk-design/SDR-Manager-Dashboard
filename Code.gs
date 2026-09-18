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
