/**
 * Human Activity Simulation - Business hours and delay utilities
 */

// Check if current time is within business hours (8h-19h) for the given timezone
export function isWithinBusinessHours(timezone: string): boolean {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    });
    const hour = parseInt(formatter.format(now), 10);
    
    // Also check if it's a weekend
    const dayFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
    });
    const day = dayFormatter.format(now);
    const isWeekend = day === "Sat" || day === "Sun";
    
    // Business hours: 8h to 19h, Monday-Friday
    return !isWeekend && hour >= 8 && hour < 19;
  } catch (e) {
    console.error("Error checking business hours:", e);
    // Default to Paris timezone if invalid
    const now = new Date();
    const parisHour = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Paris" })).getHours();
    const parisDay = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Paris" })).getDay();
    return parisDay !== 0 && parisDay !== 6 && parisHour >= 8 && parisHour < 19;
  }
}

// Get a random delay between min and max minutes in milliseconds
export function getRandomDelayMs(minMinutes: number, maxMinutes: number): number {
  const minMs = minMinutes * 60 * 1000;
  const maxMs = maxMinutes * 60 * 1000;
  return Math.floor(Math.random() * (maxMs - minMs) + minMs);
}

// Helper to sleep for a given number of milliseconds
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Get random delay between actions (30s to 2min) to simulate human behavior
export function getInterActionDelayMs(): number {
  const minMs = 30 * 1000;  // 30 seconds
  const maxMs = 120 * 1000; // 2 minutes
  return Math.floor(Math.random() * (maxMs - minMs) + minMs);
}

// Calculate next business hour slot if we're outside business hours
export function getNextBusinessHourSlot(timezone: string): Date {
  const now = new Date();
  
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    });
    const dayFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
    });
    
    let targetDate = new Date(now);
    
    // Check day and hour, skip to next valid slot
    for (let i = 0; i < 7; i++) {
      const day = dayFormatter.format(targetDate);
      const hour = parseInt(formatter.format(targetDate), 10);
      
      const isWeekend = day === "Sat" || day === "Sun";
      
      if (isWeekend) {
        // Skip to next day at 8h
        targetDate.setDate(targetDate.getDate() + 1);
        targetDate.setHours(8, Math.floor(Math.random() * 30), 0, 0);
        continue;
      }
      
      if (hour >= 19) {
        // After hours - skip to next day at 8h
        targetDate.setDate(targetDate.getDate() + 1);
        targetDate.setHours(8, Math.floor(Math.random() * 30), 0, 0);
        continue;
      }
      
      if (hour < 8) {
        // Before hours - set to 8h with random offset
        targetDate.setHours(8, Math.floor(Math.random() * 30), 0, 0);
      }
      
      // We're in a valid slot
      break;
    }
    
    return targetDate;
  } catch (e) {
    console.error("Error calculating next business slot:", e);
    // Fallback: add 1 hour
    return new Date(now.getTime() + 60 * 60 * 1000);
  }
}
