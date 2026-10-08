// Re-export KPI functions from the engine for backward compatibility
export { 
  calculateUserKpi as computeUserKpi,
  calculateAllUsersKpi,
  calculateUserKpiForPeriod,
  calculateAllUsersKpiForPeriod,
  getKpiConfig,
  getKpiRule,
  getKpiConfigRules,
  invalidateKpiConfigCache,
  invalidateTaskKpiCache,
  getCompletedTasksWithKpi,
  recordKpiTransaction
} from '../services/kpiEngine.js';