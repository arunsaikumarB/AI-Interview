/**
 * True only when stored state proves no secondary camera was ever paired: the device
 * status never left its NONE default, the interview is not live, and no SECONDARY_*
 * signal exists. Any real secondary data keeps the live signal panel.
 */
export function secondaryCameraNotUsed(input: {
  deviceStatus: string;
  interviewStatus: string;
  secondaryEventCount: number;
}): boolean {
  const live = input.interviewStatus === "IN_PROGRESS" || input.interviewStatus === "WAITING";
  return input.deviceStatus === "NONE" && !live && input.secondaryEventCount === 0;
}
