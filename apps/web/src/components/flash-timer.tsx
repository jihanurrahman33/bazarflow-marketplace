"use client";
import { useEffect, useState } from "react";

export function FlashDealsTimer() {
  const [timeLeft, setTimeLeft] = useState<{ hours: string; minutes: string; seconds: string }>({
    hours: "07",
    minutes: "38",
    seconds: "42",
  });

  useEffect(() => {
    function tick() {
      const now = new Date();
      // Target midnight tonight in Bangladesh time (UTC+6)
      const target = new Date();
      target.setHours(24, 0, 0, 0);
      const diffMs = Math.max(0, target.getTime() - now.getTime());
      const hours = Math.floor(diffMs / (1000 * 60 * 60));
      const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);

      setTimeLeft({
        hours: String(hours).padStart(2, "0"),
        minutes: String(minutes).padStart(2, "0"),
        seconds: String(seconds).padStart(2, "0"),
      });
    }

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flash-timer-wrap" aria-label={`Flash sale ends in ${timeLeft.hours} hours ${timeLeft.minutes} minutes ${timeLeft.seconds} seconds`}>
      <span className="flash-flame-badge">⚡ FLASH SALE</span>
      <div className="flash-clock">
        <span className="flash-clock-label">Ends in</span>
        <div className="flash-digits">
          <span className="digit-box">{timeLeft.hours}</span>
          <span className="digit-sep">:</span>
          <span className="digit-box">{timeLeft.minutes}</span>
          <span className="digit-sep">:</span>
          <span className="digit-box">{timeLeft.seconds}</span>
        </div>
      </div>
    </div>
  );
}
