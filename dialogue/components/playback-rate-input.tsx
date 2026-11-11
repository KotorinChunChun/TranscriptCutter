"use client";

import { useEffect, useRef, useState } from "react";
import { MIN_PLAYBACK_RATE, MAX_PLAYBACK_RATE } from "@/src/lib/transcript-playback";

type Props = {
  value: number;
  disabled?: boolean;
  onChange: (rate: number) => boolean;
  onInvalid: (message: string) => void;
};

/** Keep an unfinished decimal editable, while applying valid rates immediately. */
export function PlaybackRateInput({ value, disabled, onChange, onInvalid }: Props) {
  const [draft, setDraft] = useState(String(value));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setDraft(String(value)); }, [value]);
  const valid = (text: string) => text.trim() !== "" && Number.isFinite(Number(text)) && Number(text) >= MIN_PLAYBACK_RATE && Number(text) <= MAX_PLAYBACK_RATE;
  const commit = () => {
    focused.current = false;
    if (!valid(draft)) {
      setDraft(String(value));
      onInvalid(`再生速度は${MIN_PLAYBACK_RATE}〜${MAX_PLAYBACK_RATE}倍で指定してください。`);
      return;
    }
    const next = Number(draft);
    setDraft(String(onChange(next) ? next : value));
  };

  return <label className="playback-rate-control">
    <span>再生速度</span>
    <span className="playback-rate-field">
      <input type="number" inputMode="decimal" aria-label="再生速度（倍）" min={MIN_PLAYBACK_RATE} max={MAX_PLAYBACK_RATE} step="any"
        disabled={disabled} value={draft} title={`${MIN_PLAYBACK_RATE}〜${MAX_PLAYBACK_RATE}倍。1.5、2などの数値で指定`}
        onFocus={() => { focused.current = true; }}
        onChange={event => { const next = event.target.value; setDraft(next); if (valid(next)) onChange(Number(next)); }}
        onBlur={commit}
        onKeyDown={event => {
          if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
        }}/>
      <span aria-hidden="true">×</span>
    </span>
  </label>;
}
