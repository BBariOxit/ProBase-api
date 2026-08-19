import { rosterWhere } from './student-roster.query';

/**
 * Two screens read this: the faculty's whole student list, and the left-hand
 * column of the allocation desk. They look nothing alike, and until now each
 * carried its own copy of one sentence — "has a topic this term" — which is
 * exactly the kind of duplication that ends with two screens reporting different
 * numbers about the same student and nobody able to say which is right.
 *
 * `rosterWhere` is pure, so these are ordinary function calls. What they pin
 * down is not query syntax but the definition itself: which memberships count,
 * which do not, and what each filter is allowed to do to the others.
 */
describe('rosterWhere', () => {
  /** The shape both `some` and `none` are built from. */
  const liveIn = (semesterId: number) => ({
    semesterId,
    status: 'ACCEPTED',
    group: { status: { not: 'REJECTED' } },
  });

  describe('what counts as holding a place', () => {
    it('asks for a live membership when looking for students who have one', () => {
      const where = rosterWhere({ semesterId: 7, hasGroup: true });

      expect(where.groupMemberships).toEqual({ some: liveIn(7) });
    });

    it('asks for the absence of that same membership for students who do not', () => {
      const where = rosterWhere({ semesterId: 7, hasGroup: false });

      expect(where.groupMemberships).toEqual({ none: liveIn(7) });
    });

    /**
     * The two halves have to be the negation of one another. If "has a group"
     * and "has no group" were built from different membership shapes, a student
     * could satisfy both or neither — and the faculty list and the allocation
     * desk would disagree about whether they still need placing.
     */
    it('uses one definition for both directions', () => {
      const has = rosterWhere({ semesterId: 3, hasGroup: true });
      const hasNot = rosterWhere({ semesterId: 3, hasGroup: false });

      expect((has.groupMemberships as { some: unknown }).some).toEqual(
        (hasNot.groupMemberships as { none: unknown }).none,
      );
    });

    it('leaves membership alone when nobody asked about it', () => {
      expect(rosterWhere({ semesterId: 3 }).groupMemberships).toBeUndefined();
    });

    /**
     * A rejected group has handed its topic back, so its members are not holding
     * anything — they are exactly the students the office still has to place.
     */
    it('does not count a membership in a rejected group', () => {
      const where = rosterWhere({ semesterId: 1, hasGroup: true });
      const some = (where.groupMemberships as { some: { group: unknown } })
        .some;

      expect(some.group).toEqual({ status: { not: 'REJECTED' } });
    });

    /**
     * Without a term, the question becomes "has this student ever held a place",
     * which is a different question and the wrong one for both callers. It is
     * still allowed to build, because the roster can legitimately be read across
     * every term — what must not happen is a semester being silently invented.
     */
    it('omits the term rather than guessing one', () => {
      const where = rosterWhere({ hasGroup: false });
      const none = (where.groupMemberships as { none: object }).none;

      expect(none).not.toHaveProperty('semesterId');
    });
  });

  describe('filters', () => {
    it('narrows to the intakes a round declares', () => {
      expect(rosterWhere({ cohorts: ['2022', '2023'] }).cohort).toEqual({
        in: ['2022', '2023'],
      });
    });

    /**
     * An empty list means "no intake has been declared for this round", which is
     * not the same as "every intake" — so it must not quietly drop out and widen
     * the query. The callers refuse before reaching here; this makes sure the
     * builder would not have papered over it either.
     */
    it('ignores an empty intake list rather than matching everybody by accident', () => {
      expect(rosterWhere({ cohorts: [] }).cohort).toBeUndefined();
    });

    it('searches a name and a student code together', () => {
      expect(rosterWhere({ q: 'nguyen' }).OR).toEqual([
        { fullName: { contains: 'nguyen', mode: 'insensitive' } },
        { studentCode: { contains: 'nguyen', mode: 'insensitive' } },
      ]);
    });

    it('matches a class code loosely, because it is typed by hand', () => {
      expect(rosterWhere({ class: 'ctk46' }).class).toEqual({
        contains: 'ctk46',
        mode: 'insensitive',
      });
    });

    /**
     * Supervision reaches through the group to the topic, so filtering by
     * lecturer implies holding a place — a student with no group has no
     * supervisor to be filtered by, and returning them would be answering a
     * different question.
     */
    it('reaches a supervisor through the group that holds their topic', () => {
      const where = rosterWhere({ semesterId: 5, lecturerId: 9 });
      const some = (
        where.groupMemberships as { some: { group: { topic: unknown } } }
      ).some;

      expect(some.group.topic).toEqual({ lecturerId: 9 });
      expect(some).toMatchObject({ semesterId: 5, status: 'ACCEPTED' });
    });
  });

  describe('who is in the list at all', () => {
    it('leaves out locked and departed accounts by default', () => {
      expect(rosterWhere({}).user).toEqual({ isActive: true });
    });

    it('includes them only when somebody asks for everything', () => {
      expect(rosterWhere({ activeOnly: false }).user).toBeUndefined();
    });
  });

  it('builds nothing at all from no filters', () => {
    expect(rosterWhere({ activeOnly: false })).toEqual({});
  });
});
