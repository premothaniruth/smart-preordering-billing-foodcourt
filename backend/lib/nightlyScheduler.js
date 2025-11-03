const cron = require("node-cron");
const { runArchiveJob, listVendors } = require("./archiveScheduler");
const { analyticsIngestor } = require("./analyticsIngestor");
const analyticsConfig = require("./analyticsConfig");
const { metricsRegistry } = require("./metricsRegistry");
const { evaluateVendorForecastAccuracy } = require("./forecastingEvaluationService");

let archiveTask;
let forecastEvalTask;

const startNightlyJobs = () => {
  if (!archiveTask) {
    const cronExpr = process.env.NIGHTLY_ARCHIVE_CRON || "0 2 * * *"; // 2 AM UTC
    archiveTask = cron.schedule(cronExpr, async () => {
      try {
        metricsRegistry.incrementCounter("scheduler.archive.invocations");
        await runArchiveJob();
      } catch (error) {
        console.error("[NightlyScheduler] Archive job failed", error);
        metricsRegistry.incrementCounter("scheduler.archive.failures");
      }
    });
    archiveTask.start();
  }

  if (!forecastEvalTask) {
    const cronExpr = process.env.FORECAST_EVAL_CRON || "30 2 * * *"; // 2:30 AM UTC
    forecastEvalTask = cron.schedule(cronExpr, async () => {
      try {
        metricsRegistry.incrementCounter("scheduler.forecastEval.invocations");
        const vendors = listVendors();
        for (const vendor of vendors) {
          if (!vendor.shopId || !vendor.vendorId) continue;
          try {
            await evaluateVendorForecastAccuracy({
              vendorId: vendor.vendorId,
              shopId: vendor.shopId,
            });
          } catch (error) {
            console.error("[NightlyScheduler] Forecast evaluation failed", vendor.vendorId, error);
            metricsRegistry.incrementCounter("scheduler.forecastEval.failures");
          }
        }
      } catch (error) {
        console.error("[NightlyScheduler] Forecast evaluation run failed", error);
        metricsRegistry.incrementCounter("scheduler.forecastEval.failures");
      }
    });
    forecastEvalTask.start();
  }
};

const stopNightlyJobs = () => {
  if (archiveTask) {
    archiveTask.stop();
    archiveTask = null;
  }
  if (forecastEvalTask) {
    forecastEvalTask.stop();
    forecastEvalTask = null;
  }
};

const startIngestor = async () => {
  await analyticsIngestor.start();
};

const stopIngestor = async () => {
  await analyticsIngestor.stop();
};

module.exports = {
  startNightlyJobs,
  stopNightlyJobs,
  startIngestor,
  stopIngestor,
};
