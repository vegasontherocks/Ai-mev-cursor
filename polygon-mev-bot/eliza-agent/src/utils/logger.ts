export const logger = {
  info: (...args: any[]) => {
    console.log(new Date().toISOString(), '[INFO]', ...args);
  },
  warn: (...args: any[]) => {
    console.warn(new Date().toISOString(), '[WARN]', ...args);
  },
  error: (...args: any[]) => {
    console.error(new Date().toISOString(), '[ERROR]', ...args);
  },
  debug: (...args: any[]) => {
    if (process.env.DEBUG === 'true') {
      console.log(new Date().toISOString(), '[DEBUG]', ...args);
    }
  },
  success: (...args: any[]) => {
    console.log(new Date().toISOString(), '[SUCCESS] ✅', ...args);
  },
  opportunity: (...args: any[]) => {
    console.log(new Date().toISOString(), '[OPPORTUNITY] 🎯', ...args);
  },
  profit: (...args: any[]) => {
    console.log(new Date().toISOString(), '[PROFIT] 💰', ...args);
  },
};
