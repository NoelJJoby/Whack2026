export const companyLimits = {
  minDeadline: 4,
  defaultDeadline: 32,
  maxDeadline: 96,
  graceTicks: 24,
  maxRework: 3,
  messageCost: 0.2,
  authoredPerTick: 2,
  messagesPerTick: 8,
  reminderTicks: 3,
  escalationTicks: 3,
} as const;
