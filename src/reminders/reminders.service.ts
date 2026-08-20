import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  GroupMemberStatus,
  NotificationType,
  RegistrationGroupStatus,
  RoundPhase,
} from '../../generated/prisma/client';
import { formatDate } from '../common/named-day.util';
import {
  NotificationsService,
  type NewNotification,
} from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { RoundPhaseService } from '../rounds/round-phase.service';

/**
 * How far ahead a deadline has to be before it is worth mentioning.
 *
 * Three days is chosen against what the reader can still do about it. A student
 * with no group needs an evening to ask around and a morning to register; a
 * group that has not written its report is not going to write it because of a
 * notice, but three days is enough to hand in what they have.
 */
const LEAD_DAYS = 3;

/** The phases in which the gate is still something a student can walk through. */
const GATE_OPEN: readonly RoundPhase[] = [RoundPhase.OPEN, RoundPhase.EXTENDED];

/** What one pass of the job did, per kind of reminder. */
export interface ReminderRun {
  registrationClosingSoon: number;
  submissionsDueSoon: number;
}

/**
 * The notices nobody's action produces: the ones the calendar owes people.
 *
 * Everything else in this system is worked out when somebody looks — a round's
 * phase, a topic's free seats — and that is the right answer for state, because
 * a value nobody has read has harmed nobody. Reminders invert it. The reader who
 * needs one is exactly the reader who is not opening the app, so something has
 * to run whether or not anyone is watching.
 *
 * The rule that makes this safe is in how each pass asks its question. It does
 * not ask "is today three days before the deadline" — a run missed because the
 * server was restarting would then lose that reminder for good, and two runs in
 * one morning would send it twice. It asks "is this deadline within three days,
 * and has this reader not been told" — so a pass that never happened is made up
 * by the next one, and a pass that happens twice writes nothing the second time.
 * The refusing is done by a unique index on `notifications.dedupeKey`, not by a
 * check-then-write, so two instances racing produce one notice rather than two.
 */
@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly phases: RoundPhaseService,
  ) {}

  /**
   * Once a day, early enough that a student reading it over breakfast still has
   * the day to act.
   *
   * Daily rather than hourly because every deadline here is counted in days: a
   * job that ran twelve times more often would send exactly the same notices and
   * would only widen the window in which two instances collide.
   */
  @Cron('0 7 * * *', {
    name: 'deadline-reminders',
    timeZone: 'Asia/Ho_Chi_Minh',
  })
  async runDaily(): Promise<void> {
    const sent = await this.run();

    this.logger.log(
      `Deadline reminders: ${sent.registrationClosingSoon} về hạn đăng ký, ${sent.submissionsDueSoon} về hạn nộp bài`,
    );
  }

  /** One pass, also reachable by hand so the office never has to wait for 07:00. */
  async run(): Promise<ReminderRun> {
    const [registrationClosingSoon, submissionsDueSoon] = await Promise.all([
      this.remindRegistrationClosing(),
      this.remindSubmissionsDue(),
    ]);

    return { registrationClosingSoon, submissionsDueSoon };
  }

  /**
   * Students the gate is about to close on while they still have no group.
   *
   * The most valuable notice in the system, because it is the last one that
   * still leaves the outcome in the reader's hands. After it, their only
   * remaining route to a topic is the faculty office placing them on one.
   *
   * The phase is resolved rather than read off the row, for the same reason
   * every other caller resolves it: a round whose gate opened this morning still
   * says PREP until something asks.
   */
  private async remindRegistrationClosing(): Promise<number> {
    const rounds = await this.prisma.registrationRound.findMany({
      where: { registrationEnd: this.closingWindow() },
      select: {
        id: true,
        semesterId: true,
        phase: true,
        registrationStart: true,
        registrationEnd: true,
        projectType: { select: { name: true } },
        eligibilities: { select: { cohort: true } },
      },
    });

    if (rounds.length === 0) return 0;

    const phases = await this.phases.resolveMany(rounds);
    const notices: NewNotification[] = [];

    for (const round of rounds) {
      const phase = phases.get(round.id) ?? round.phase;
      if (!GATE_OPEN.includes(phase)) continue;

      const userIds = await this.notifications.studentsWithoutGroupIn({
        semesterId: round.semesterId,
        cohorts: round.eligibilities.map((rule) => rule.cohort),
      });

      notices.push(
        ...userIds.map((userId) => ({
          userId,
          type: NotificationType.REGISTRATION_CLOSING_SOON,
          title: 'Sắp hết hạn đăng ký đề tài',
          content: `${round.projectType.name} đóng đăng ký ngày ${formatDate(round.registrationEnd)}. Bạn chưa có nhóm — sau hạn này khoa sẽ xếp đề tài cho bạn.`,
          targetId: round.id,
          // The deadline is part of the key, so an extension is a new thing to
          // be told about rather than a repeat of the notice already sent.
          dedupeKey: `REGISTRATION_CLOSING_SOON:round=${round.id}:end=${round.registrationEnd.toISOString()}:user=${userId}`,
        })),
      );
    }

    return this.notifications.notify(notices);
  }

  /**
   * Groups with something due and nothing handed in against it.
   *
   * Driven by the list each round declares rather than by a fixed pair of
   * dates, so a faculty that asks for a đề cương and then a quyển báo cáo gets
   * a reminder for each, named the way the office named it.
   *
   * Only the group that owes the work is written to, not every group in the
   * round: a notice that turns out not to be about you is what teaches people to
   * stop reading the next one. A group that handed something in and then wants
   * to revise it needs no reminder — the deadline is on their screen.
   *
   * Optional items are reminded about too. They are still work the office asked
   * for; what "optional" changes is whether a group counts as finished without
   * them, not whether anybody should be told.
   */
  private async remindSubmissionsDue(): Promise<number> {
    const due = await this.prisma.submissionRequirement.findMany({
      where: { dueAt: this.closingWindow() },
      select: { id: true, roundId: true, name: true, dueAt: true },
    });

    const notices: NewNotification[] = [];

    for (const requirement of due) {
      const groups = await this.groupsOwing(
        requirement.roundId,
        requirement.id,
      );

      for (const group of groups) {
        notices.push(
          ...group.members.map((member) => ({
            userId: member.student.userId,
            type: NotificationType.SUBMISSION_DUE_SOON,
            title: `Sắp tới hạn nộp ${requirement.name.toLowerCase()}`,
            content: `Nhóm của bạn chưa nộp ${requirement.name.toLowerCase()} cho đề tài "${group.topic.title}". Hạn nộp: ${formatDate(requirement.dueAt)}. Nộp muộn vẫn được nhận nhưng sẽ bị đánh dấu.`,
            targetId: group.id,
            // The deadline is part of the key, so an office that moves it is a
            // new thing to be told about rather than a repeat.
            dedupeKey: `SUBMISSION_DUE_SOON:req=${requirement.id}:due=${requirement.dueAt.toISOString()}:user=${member.student.userId}`,
          })),
        );
      }
    }

    return this.notifications.notify(notices);
  }

  /**
   * The live groups in a round that have handed in nothing against this
   * requirement, with the accounts to write to.
   *
   * Locked accounts are left out: a reminder is an instruction to go and do
   * something, and that account cannot.
   */
  private async groupsOwing(roundId: number, requirementId: number) {
    return this.prisma.registrationGroup.findMany({
      where: {
        status: { not: RegistrationGroupStatus.REJECTED },
        topic: { roundId },
        submissions: { none: { requirementId } },
      },
      select: {
        id: true,
        topic: { select: { title: true } },
        members: {
          where: {
            status: GroupMemberStatus.ACCEPTED,
            student: { user: { isActive: true } },
          },
          select: { student: { select: { userId: true } } },
        },
      },
    });
  }

  /**
   * From now to the lead time — never a deadline already past.
   *
   * The lower bound is what keeps this from nagging about work that can no
   * longer be handed in on time, and it is also why every pass is safe to
   * repeat: the window empties itself as deadlines go by.
   */
  private closingWindow() {
    const now = new Date();
    const until = new Date(now);
    until.setDate(until.getDate() + LEAD_DAYS);

    return { gt: now, lte: until };
  }
}
