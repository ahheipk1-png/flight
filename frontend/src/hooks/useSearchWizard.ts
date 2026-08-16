"use client";

// Owns the wizard's draft state. Instantiated once in page.tsx (not
// inside SearchWizard itself) so the draft survives the idle -> searching
// -> results -> idle round trip -- "Edit search" must return the user to
// what they typed, not a blank form.

import { useCallback, useMemo, useState } from "react";
import type { SearchSubmission, TripType } from "@/lib/types";
import {
  addDaysIso,
  buildSubmission,
  defaultDraft,
  MAX_LEGS,
  MIN_LEGS,
  stepsFor,
  validateStep,
  type LegDraft,
  type StepError,
  type WizardDraft,
} from "@/lib/search/wizard";

export function useSearchWizard(anywhereRegionCodes: string[]) {
  const [draft, setDraft] = useState<WizardDraft>(defaultDraft);
  const [error, setError] = useState<StepError | null>(null);

  const steps = useMemo(() => stepsFor(draft.tripType), [draft.tripType]);
  const stepIndex = steps.indexOf(draft.step);

  const patch = useCallback((partial: Partial<WizardDraft>) => {
    setError(null);
    setDraft((prev) => ({ ...prev, ...partial }));
  }, []);

  const setTripType = useCallback((tripType: TripType) => {
    setError(null);
    setDraft((prev) => ({ ...prev, tripType }));
  }, []);

  const goTo = useCallback((step: WizardDraft["step"]) => {
    setError(null);
    setDraft((prev) => ({ ...prev, step }));
  }, []);

  const next = useCallback(() => {
    const err = validateStep(draft);
    if (err) {
      setError(err);
      return;
    }
    const currentSteps = stepsFor(draft.tripType);
    const idx = currentSteps.indexOf(draft.step);
    if (idx < currentSteps.length - 1) goTo(currentSteps[idx + 1]);
  }, [draft, goTo]);

  const back = useCallback(() => {
    setError(null);
    const currentSteps = stepsFor(draft.tripType);
    const idx = currentSteps.indexOf(draft.step);
    if (idx > 0) goTo(currentSteps[idx - 1]);
  }, [draft, goTo]);

  const updateLeg = useCallback((index: number, leg: Partial<LegDraft>) => {
    setDraft((prev) => ({ ...prev, legs: prev.legs.map((l, i) => (i === index ? { ...l, ...leg } : l)) }));
  }, []);

  const addLeg = useCallback(() => {
    setDraft((prev) =>
      prev.legs.length >= MAX_LEGS
        ? prev
        : { ...prev, legs: [...prev.legs, { destination: null, date: addDaysIso(prev.legs[prev.legs.length - 1].date, 7) }] },
    );
  }, []);

  const removeLeg = useCallback((index: number) => {
    setDraft((prev) => (prev.legs.length <= MIN_LEGS ? prev : { ...prev, legs: prev.legs.filter((_, i) => i !== index) }));
  }, []);

  const submit = useCallback((): SearchSubmission | null => {
    const result = buildSubmission(draft, { anywhereRegionCodes });
    if (!result.ok) {
      setError(result.error);
      return null;
    }
    return result.submission;
  }, [draft, anywhereRegionCodes]);

  const reset = useCallback(() => {
    setError(null);
    setDraft(defaultDraft());
  }, []);

  return { draft, patch, setTripType, steps, stepIndex, error, next, back, goTo, updateLeg, addLeg, removeLeg, submit, reset };
}

export type SearchWizardApi = ReturnType<typeof useSearchWizard>;
