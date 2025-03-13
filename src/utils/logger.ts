// Logger utility for controlling log verbosity

import winston from 'winston';

// Add browser compatibility shim for setImmediate (used by Winston internally)
if (typeof window !== 'undefined' && !window.setImmediate) {
  // Using any to bypass the strict typing requirements
  (window as any).setImmediate = (callback: Function, ...args: any[]) => 
    setTimeout(callback, 0, ...args);
}

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// Set this to control log level in different environments
const CURRENT_LOG_LEVEL: LogLevel = 
  process.env.NODE_ENV === 'production' ? 'warn' : 'debug';

// Set to false to disable verbose object logging
const ENABLE_VERBOSE_OBJECTS = process.env.NODE_ENV !== 'production';

// Create Winston format for object handling with BigInt support
const objectHandlingFormat = winston.format((info) => {
  // Handle objects with BigInt values in the message arguments
  const args = info.args as any[] || [];
  if (args.length > 0) {
    info.args = args.map((arg: any) => 
      typeof arg === 'object' && arg !== null ? formatObject(arg) : arg
    );
  }
  return info;
});

// Interface for Winston log info with args
interface CustomLogInfo extends winston.Logform.TransformableInfo {
  args?: any[];
  timestamp?: string;
}

// Create a safe formatter that catches errors
const safeStringify = (obj: any): string => {
  try {
    // Handle BigInt values
    return JSON.stringify(obj, (_, value) => 
      typeof value === 'bigint' ? value.toString() : value
    );
  } catch (e) {
    return '[Unstringifiable Object]';
  }
};

// Create the Winston logger
const winstonLogger = winston.createLogger({
  level: CURRENT_LOG_LEVEL,
  format: winston.format.combine(
    objectHandlingFormat(),
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.printf((info: CustomLogInfo) => {
      const { level, message, timestamp, args = [] } = info;
      
      // Safely stringify arguments
      const argsString = args.length > 0 
        ? args.map((a: any) => {
            if (typeof a === 'string') return a;
            return safeStringify(a).substring(0, 200) + 
                  (safeStringify(a).length > 200 ? '...' : '');
          }).join(' ')
        : '';
      
      return `${timestamp} [${level.toUpperCase()}] ${message} ${argsString}`;
    })
  ),
  transports: [
    // Console transport
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize({ all: true }),
        winston.format.printf((info: CustomLogInfo) => {
          const { level, message, args = [] } = info;
          const emoji = getEmojiForLevel(level);
          
          // Safely stringify arguments
          const argsString = args.length > 0 
            ? ' ' + args.map((a: any) => {
                if (typeof a === 'string') return a;
                return safeStringify(a).substring(0, 200) + 
                      (safeStringify(a).length > 200 ? '...' : '');
              }).join(' ')
            : '';
          
          return `${emoji} ${message}${argsString}`;
        })
      )
    })
  ]
});

// Helper function to get emoji for log level
function getEmojiForLevel(level: string): string {
  switch (level) {
    case 'debug': return '🔍';
    case 'info': return 'ℹ️';
    case 'warn': return '⚠️';
    case 'error': return '❌';
    default: return '';
  }
}

// Format objects for logging
export const formatObject = (obj: any): any => {
  if (!ENABLE_VERBOSE_OBJECTS) {
    return '[Object]'; // Ultra simplified in production
  }
  
  try {
    // Handle BigInt values safely
    return safeStringify(obj).substring(0, 200) + 
           (safeStringify(obj).length > 200 ? '...' : '');
  } catch (e) {
    return '[Complex Object]';
  }
};

// Format UserOperation for logging (with reduced verbosity)
export const formatUserOp = (userOp: any): any => {
  if (!userOp) return null;
  
  // Helper to safely convert values to string
  const safeToString = (value: any): string => {
    if (value === undefined || value === null) return 'not set';
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v);
      } catch (e) {
        return '[Complex Object]';
      }
    }
    return String(value);
  };
  
  return {
    sender: userOp.sender,
    nonce: safeToString(userOp.nonce),
    callGasLimit: safeToString(userOp.callGasLimit),
    verificationGasLimit: safeToString(userOp.verificationGasLimit),
    preVerificationGas: safeToString(userOp.preVerificationGas),
    maxFeePerGas: safeToString(userOp.maxFeePerGas),
    maxPriorityFeePerGas: safeToString(userOp.maxPriorityFeePerGas),
    // Only show first 10 chars of long hex strings
    signature: userOp.signature ? 
      `${userOp.signature.substring(0, 10)}...` : 'not set',
    // Handle both v0.6 and v0.7 paymaster formats
    paymasterAndData: userOp.paymasterAndData ? 
      (userOp.paymasterAndData === '0x' ? '0x' : 
       `${userOp.paymasterAndData.substring(0, 10)}...`) : 'not set',
    paymaster: userOp.paymaster || 'not set',
    paymasterData: userOp.paymasterData ? 
      `${userOp.paymasterData.substring(0, 10)}...` : 'not set',
    paymasterVerificationGasLimit: safeToString(userOp.paymasterVerificationGasLimit),
    paymasterPostOpGasLimit: safeToString(userOp.paymasterPostOpGasLimit)
  };
};

// Format transaction details for logging
export const formatTransaction = (tx: any): any => {
  if (!tx) return null;
  
  return {
    to: tx.to || 'not set',
    value: tx.value?.toString() || '0',
    data: tx.data ? 
      (tx.data === '0x' ? '0x' : `${tx.data.substring(0, 10)}...`) : 'not set',
    gas: tx.gas?.toString() || 'not set'
  };
};

// Create a simplified fallback logger
const createSimpleLogger = () => {
  const simpleLogger = {
    debug: (message: string, ...args: any[]) => {
      if (CURRENT_LOG_LEVEL === 'debug') {
        console.debug('🔍', message, ...args.map(arg => 
          typeof arg === 'object' ? formatObject(arg) : arg
        ));
      }
    },
    
    info: (message: string, ...args: any[]) => {
      if (['debug', 'info'].includes(CURRENT_LOG_LEVEL)) {
        console.info('ℹ️', message, ...args.map(arg => 
          typeof arg === 'object' ? formatObject(arg) : arg
        ));
      }
    },
    
    log: (message: string, ...args: any[]) => {
      if (['debug', 'info'].includes(CURRENT_LOG_LEVEL)) {
        console.log('ℹ️', message, ...args.map(arg => 
          typeof arg === 'object' ? formatObject(arg) : arg
        ));
      }
    },
    
    warn: (message: string, ...args: any[]) => {
      if (['debug', 'info', 'warn'].includes(CURRENT_LOG_LEVEL)) {
        console.warn('⚠️', message, ...args.map(arg => 
          typeof arg === 'object' ? formatObject(arg) : arg
        ));
      }
    },
    
    error: (message: string, ...args: any[]) => {
      console.error('❌', message, ...args.map(arg => 
        typeof arg === 'object' ? formatObject(arg) : arg
      ));
    },
    
    userOp: (message: string, userOp: any) => {
      if (CURRENT_LOG_LEVEL === 'debug') {
        console.debug('🔍', message, formatUserOp(userOp));
      }
    },
    
    gasPrice: (message: string, gasPrice: any) => {
      if (['debug', 'info'].includes(CURRENT_LOG_LEVEL)) {
        if (!gasPrice) {
          console.info('ℹ️', `${message}: unavailable`);
          return;
        }
        console.info('ℹ️', message, {
          standard: gasPrice.standard ? 
            `${gasPrice.standard.maxFeePerGas?.toString().substring(0, 8)}...` : 'N/A'
        });
      }
    },
    
    transaction: (message: string, tx: any) => {
      if (CURRENT_LOG_LEVEL === 'debug') {
        console.debug('🔍', message, formatTransaction(tx));
      }
    }
  };
  
  return simpleLogger;
};

// Try using Winston, but fall back to simple logger if it fails
let activeLogger: any;

try {
  // Logger API (maintains the same interface but uses Winston)
  activeLogger = {
    debug: (message: string, ...args: any[]) => {
      try {
        winstonLogger.debug(message, { args });
      } catch (e) {
        console.debug('🔍', message, ...args);
      }
    },
    
    info: (message: string, ...args: any[]) => {
      try {
        winstonLogger.info(message, { args });
      } catch (e) {
        console.info('ℹ️', message, ...args);
      }
    },
    
    log: (message: string, ...args: any[]) => {
      try {
        winstonLogger.info(message, { args });
      } catch (e) {
        console.log('ℹ️', message, ...args);
      }
    },
    
    warn: (message: string, ...args: any[]) => {
      try {
        winstonLogger.warn(message, { args });
      } catch (e) {
        console.warn('⚠️', message, ...args);
      }
    },
    
    error: (message: string, ...args: any[]) => {
      try {
        winstonLogger.error(message, { args });
      } catch (e) {
        console.error('❌', message, ...args);
      }
    },
    
    // Special function for UserOp logging
    userOp: (message: string, userOp: any) => {
      try {
        winstonLogger.debug(message, { args: [formatUserOp(userOp)] });
      } catch (e) {
        console.debug('🔍', message, formatUserOp(userOp));
      }
    },
    
    // Function for gas price logging
    gasPrice: (message: string, gasPrice: any) => {
      try {
        if (!gasPrice) {
          winstonLogger.info(`${message}: unavailable`);
          return;
        }
        
        winstonLogger.info(message, { 
          args: [{
            standard: gasPrice.standard ? 
              `${gasPrice.standard.maxFeePerGas?.toString().substring(0, 8)}...` : 'N/A'
          }]
        });
      } catch (e) {
        if (!gasPrice) {
          console.info('ℹ️', `${message}: unavailable`);
          return;
        }
        console.info('ℹ️', message, {
          standard: gasPrice.standard ? 
            `${gasPrice.standard.maxFeePerGas?.toString().substring(0, 8)}...` : 'N/A'
        });
      }
    },
    
    // Function for transaction logging
    transaction: (message: string, tx: any) => {
      try {
        winstonLogger.debug(message, { args: [formatTransaction(tx)] });
      } catch (e) {
        console.debug('🔍', message, formatTransaction(tx));
      }
    }
  };
  
  // Test if Winston works
  activeLogger.debug('Winston logger initialized successfully');
} catch (e) {
  console.warn('Winston logger initialization failed, using simple logger instead:', e);
  activeLogger = createSimpleLogger();
}

export const logger = activeLogger;

// Add file transport in non-dev environments and only in Node.js environment
if (typeof window === 'undefined' && process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') {
  try {
    winstonLogger.add(
      new winston.transports.File({ 
        filename: 'app.log',
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.json()
        )
      })
    );
  } catch (e) {
    console.warn('Failed to add file transport to Winston logger:', e);
  }
}

export default logger; 