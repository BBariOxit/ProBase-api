import { RoundPhase } from '../../generated/prisma/client';
import { duePhase } from './round-phase.service';

/**
 * The phase machine is the one piece of registration that decides, on every
 * request, whether anybody may do anything at all — and it decides silently. A
 * wrong answer here does not throw: it opens a gate that should be shut, or
 * shuts one the faculty announced as open, and the first sign of either is a
 * student saying the button does nothing.
 *
 * `duePhase` is pure, so these are ordinary function calls. What they pin down
 * is not arithmetic but policy: which transitions a date is allowed to make, and
 * which it is not.
 */
describe('duePhase', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const daysFromNow = (days: number) => new Date(Date.now() + days * DAY);

  describe('PREP', () => {
    it('waits while the start date is still ahead', () => {
      expect(
        duePhase({
          phase: RoundPhase.PREP,
          registrationStart: daysFromNow(3),
          registrationEnd: daysFromNow(20),
        }),
      ).toBe(RoundPhase.PREP);
    });

    it('opens once the start date has passed', () => {
      expect(
        duePhase({
          phase: RoundPhase.PREP,
          registrationStart: daysFromNow(-1),
          registrationEnd: daysFromNow(20),
        }),
      ).toBe(RoundPhase.OPEN);
    });

    /**
     * A round nobody looked at for the whole of its window must not open now
     * that its window is over. Reading the start date first would do exactly
     * that, which is why the end date is checked before it.
     */
    it('goes straight to RECONCILING when both dates are already past', () => {
      expect(
        duePhase({
          phase: RoundPhase.PREP,
          registrationStart: daysFromNow(-30),
          registrationEnd: daysFromNow(-2),
        }),
      ).toBe(RoundPhase.RECONCILING);
    });
  });

  describe('OPEN', () => {
    it('stays open until the deadline is genuinely past', () => {
      expect(
        duePhase({
          phase: RoundPhase.OPEN,
          registrationStart: daysFromNow(-10),
          registrationEnd: daysFromNow(1),
        }),
      ).toBe(RoundPhase.OPEN);
    });

    it('closes once the deadline has passed', () => {
      expect(
        duePhase({
          phase: RoundPhase.OPEN,
          registrationStart: daysFromNow(-10),
          registrationEnd: daysFromNow(-1),
        }),
      ).toBe(RoundPhase.RECONCILING);
    });
  });

  /**
   * An extension is a new `registrationEnd` plus a phase saying which window
   * this is, so it leaves on the same comparison OPEN does. That is what stops
   * an extension outliving the deadline it was granted.
   */
  describe('EXTENDED', () => {
    it('runs until the extended deadline', () => {
      expect(
        duePhase({
          phase: RoundPhase.EXTENDED,
          registrationStart: daysFromNow(-30),
          registrationEnd: daysFromNow(2),
        }),
      ).toBe(RoundPhase.EXTENDED);
    });

    it('falls back to RECONCILING when the extension runs out', () => {
      expect(
        duePhase({
          phase: RoundPhase.EXTENDED,
          registrationStart: daysFromNow(-30),
          registrationEnd: daysFromNow(-1),
        }),
      ).toBe(RoundPhase.RECONCILING);
    });
  });

  /**
   * The half of the machine that dates may not touch. Both of these phases were
   * entered because somebody pressed something, and letting a date undo that
   * would mean an office editing a deadline could silently reopen a round whose
   * allocation was being settled — or one already settled.
   */
  describe('phases no date may leave', () => {
    it('keeps RECONCILING even if the deadline is moved into the future', () => {
      expect(
        duePhase({
          phase: RoundPhase.RECONCILING,
          registrationStart: daysFromNow(-30),
          registrationEnd: daysFromNow(7),
        }),
      ).toBe(RoundPhase.RECONCILING);
    });

    it('keeps FINALIZED even if the whole window is still ahead', () => {
      expect(
        duePhase({
          phase: RoundPhase.FINALIZED,
          registrationStart: daysFromNow(5),
          registrationEnd: daysFromNow(30),
        }),
      ).toBe(RoundPhase.FINALIZED);
    });
  });
});
