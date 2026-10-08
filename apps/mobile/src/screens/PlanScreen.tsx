import type { PlannedSession, RescheduleEvent, ScheduleProposal } from '@fitness/engine';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { explainPlan, screen } from '../engine/engine-service';
import { minimumDoseProposal, rescheduleProposals } from '../logic/actions';
import { formatShortDate } from '../logic/labels';
import {
  currentWeek,
  isOpen,
  loggedSessionIds,
  sessionDisplayStatus,
  sessionsByDate,
  SESSION_STATUS_LABELS,
  todaysSession,
  type SessionDisplayStatus,
} from '../logic/plan-view';
import type { AppData } from '../storage/repository';
import { useStore } from '../state/store';
import {
  Badge,
  Body,
  Button,
  Card,
  Chip,
  ChipRow,
  ErrorText,
  Heading,
  Row,
  Screen,
  Title,
} from '../ui/components';
import { colors, spacing } from '../ui/theme';

const STATUS_TONES: Record<SessionDisplayStatus, 'neutral' | 'good' | 'bad' | 'info'> = {
  done: 'good',
  skipped: 'neutral',
  merged: 'neutral',
  missed: 'bad',
  today: 'info',
  upcoming: 'neutral',
};

const SHORT_ON_TIME_MINUTES = [15, 20, 30] as const;

type PanelRequest =
  { sessionId: string; mode: 'missed' } | { sessionId: string; mode: 'shorten'; minutes: number };
type Panel = PanelRequest & { proposals: ScheduleProposal[] };

export interface PlanScreenProps {
  data: AppData;
  onOpenSession: (sessionId: string) => void;
  onEditAnswers: () => void;
}

export function PlanScreen({ data, onOpenSession, onEditAnswers }: PlanScreenProps) {
  const store = useStore();
  const [panel, setPanel] = useState<Panel | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showExplanation, setShowExplanation] = useState(false);
  const { plan, profile } = data;

  if (!plan || !profile) {
    // After edited answers fail screening the plan is removed; say why instead of a blank state.
    const screening = profile ? screen(profile, store.today()) : null;
    if (screening && !screening.ok) {
      return (
        <Screen testID="plan-blocked">
          <Title>Please check with a professional first</Title>
          <Card testID="screening-message">
            <Body>{screening.message}</Body>
          </Card>
          <Button label="Review my answers" onPress={onEditAnswers} testID="review-answers" />
        </Screen>
      );
    }
    return (
      <Screen testID="plan-empty">
        <Title>No active plan</Title>
        <Body>Answer a few questions and we will build a plan for you.</Body>
        <Button
          label={profile ? 'Review my answers' : 'Start onboarding'}
          onPress={onEditAnswers}
          testID="start-onboarding"
        />
      </Screen>
    );
  }

  const today = store.today();
  const ctx = { now: store.services.now(), newId: store.services.newId };
  const logged = loggedSessionIds(data.workoutLogs);
  const { week, relation } = currentWeek(plan, today);
  const next = todaysSession(plan, today, data.workoutLogs);

  const run = (action: () => Promise<void>, success: string) => {
    setError(null);
    action()
      .then(() => {
        setPanel(null);
        setNotice(success);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
      });
  };

  /** Asks the engine for proposals once, when the panel opens (stable change ids). */
  const openPanel = (request: PanelRequest) => {
    const event: RescheduleEvent =
      request.mode === 'missed'
        ? { type: 'missed', session_id: request.sessionId }
        : { type: 'shorten', session_id: request.sessionId, available_minutes: request.minutes };
    setNotice(null);
    try {
      setPanel({ ...request, proposals: rescheduleProposals(plan, profile, event, ctx) });
      setError(null);
    } catch (cause) {
      setPanel(null);
      setError(
        `Could not compute options: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  };

  const applyMinimumDose = (session: PlannedSession) => {
    const proposal = minimumDoseProposal(plan, profile, session.id, ctx);
    if (!proposal) {
      setNotice(`${session.title} already fits in 15 minutes.`);
      return;
    }
    run(
      () => store.acceptProposal(proposal),
      proposal.changes.map((change) => change.reason).join(' '),
    );
  };

  return (
    <Screen testID="plan-screen">
      <Title>Your plan</Title>
      {data.planNotes?.plan_id === plan.id && data.planNotes.warnings.length > 0 ? (
        <Card testID="plan-warnings">
          <Heading>Good to know</Heading>
          {data.planNotes.warnings.map((warning) => (
            <Body key={warning}>{warning}</Body>
          ))}
        </Card>
      ) : null}
      <Card testID="plan-explanation">
        <Button
          label={showExplanation ? 'Hide why this plan' : 'Why this plan?'}
          variant="secondary"
          onPress={() => {
            setShowExplanation(!showExplanation);
          }}
          testID="toggle-explanation"
        />
        {showExplanation ? <PlanExplanation data={data} /> : null}
      </Card>
      {next ? (
        <Card testID={`today-card-${next.session.id}`}>
          <Body muted>
            {next.isToday
              ? 'Today'
              : `Next session: ${formatShortDate(next.session.scheduled_date)}`}
          </Body>
          <Heading>{next.session.title}</Heading>
          <Body muted>
            About {next.session.est_minutes} min · {next.session.exercises.length} exercises
          </Body>
          <Button
            label={next.isToday ? 'Start workout' : 'Start now anyway'}
            onPress={() => {
              onOpenSession(next.session.id);
            }}
            disabled={store.busy}
            testID="start-today"
          />
        </Card>
      ) : (
        <Card testID="plan-finished">
          <Heading>Plan complete</Heading>
          <Body>You have reached the end of this block. Regenerate your plan in Settings.</Body>
        </Card>
      )}

      {notice !== null ? (
        <Card testID="notice">
          <Body>{notice}</Body>
        </Card>
      ) : null}
      {error !== null ? <ErrorText testID="plan-error">{error}</ErrorText> : null}

      <Heading>
        Week {week.index + 1} of {plan.weeks.length} · {week.phase}
      </Heading>
      {relation === 'before_start' ? (
        <Body muted>Your plan starts on {formatShortDate(plan.start_date)}.</Body>
      ) : null}
      {week.focus !== undefined ? <Body muted>{week.focus}</Body> : null}

      {sessionsByDate(week).map((session) => {
        const status = sessionDisplayStatus(session, today, logged);
        const open = isOpen(session, logged);
        const panelOpen = panel?.sessionId === session.id;
        return (
          <Card key={session.id} testID={`session-${session.id}`}>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                onOpenSession(session.id);
              }}
              testID={`open-session-${session.id}`}
              style={styles.sessionHeader}
            >
              <View style={styles.sessionTitle}>
                <Heading>{session.title}</Heading>
                <Body muted>
                  {formatShortDate(session.scheduled_date)} · {session.est_minutes} min
                  {session.variant === 'short' ? ' · short version' : ''}
                  {session.variant === 'minimum_dose' ? ' · minimum dose' : ''}
                  {session.status === 'moved' ? ' · moved' : ''}
                </Body>
              </View>
              <Badge
                label={SESSION_STATUS_LABELS[status]}
                tone={STATUS_TONES[status]}
                testID={`status-${session.id}`}
              />
            </Pressable>
            {open ? (
              <Row>
                {status === 'missed' ? (
                  <Button
                    label="Reschedule"
                    variant="secondary"
                    onPress={() => {
                      openPanel({ sessionId: session.id, mode: 'missed' });
                    }}
                    disabled={store.busy}
                    testID="reschedule-missed"
                  />
                ) : (
                  <>
                    <Button
                      label="Can't make it"
                      variant="secondary"
                      onPress={() => {
                        openPanel({ sessionId: session.id, mode: 'missed' });
                      }}
                      disabled={store.busy}
                      testID="cant-make-it"
                    />
                    <Button
                      label="Short on time"
                      variant="secondary"
                      onPress={() => {
                        openPanel({ sessionId: session.id, mode: 'shorten', minutes: 30 });
                      }}
                      disabled={store.busy}
                      testID="short-on-time"
                    />
                  </>
                )}
                {session.variant !== 'minimum_dose' ? (
                  <Button
                    label="Minimum dose (10–15 min)"
                    variant="secondary"
                    onPress={() => {
                      applyMinimumDose(session);
                    }}
                    disabled={store.busy}
                    testID="minimum-dose"
                  />
                ) : null}
              </Row>
            ) : null}
            {panelOpen ? (
              <View style={styles.panel} testID="proposals">
                {panel.mode === 'shorten' ? (
                  <>
                    <Body>How many minutes do you have?</Body>
                    <ChipRow>
                      {SHORT_ON_TIME_MINUTES.map((minutes) => (
                        <Chip
                          key={minutes}
                          label={`${minutes} min`}
                          selected={panel.minutes === minutes}
                          onPress={() => {
                            openPanel({ sessionId: session.id, mode: 'shorten', minutes });
                          }}
                        />
                      ))}
                    </ChipRow>
                  </>
                ) : null}
                <ProposalList
                  proposals={panel.proposals}
                  busy={store.busy}
                  onAccept={(proposal) => {
                    run(() => store.acceptProposal(proposal), 'Your week has been updated.');
                  }}
                />
                <Button
                  label="Cancel"
                  variant="secondary"
                  onPress={() => {
                    setPanel(null);
                  }}
                />
              </View>
            ) : null}
          </Card>
        );
      })}
    </Screen>
  );
}

const KIND_LABELS: Record<ScheduleProposal['kind'], string> = {
  move: 'Move',
  merge: 'Merge',
  shorten: 'Shorten',
  skip: 'Skip',
};

function ProposalList({
  proposals,
  busy,
  onAccept,
}: {
  proposals: ScheduleProposal[];
  busy: boolean;
  onAccept: (proposal: ScheduleProposal) => void;
}) {
  if (proposals.length === 0) {
    return <Body muted>The full session already fits. No change needed.</Body>;
  }
  return (
    <>
      {proposals.map((proposal, index) => (
        <View key={proposal.changes.map((change) => change.id).join('-')} style={styles.proposal}>
          <Badge
            label={
              index === 0
                ? `${KIND_LABELS[proposal.kind]} (recommended)`
                : KIND_LABELS[proposal.kind]
            }
            tone="info"
          />
          {proposal.changes.map((change) => (
            <Body key={change.id}>{change.reason}</Body>
          ))}
          <Button
            label={`Accept: ${KIND_LABELS[proposal.kind].toLowerCase()}`}
            onPress={() => {
              onAccept(proposal);
            }}
            disabled={busy}
            testID={`accept-proposal-${index}`}
          />
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  sessionHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  sessionTitle: { flex: 1, gap: spacing.xs },
  panel: {
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  proposal: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: 8,
    backgroundColor: colors.background,
  },
});

function PlanExplanation({ data }: { data: AppData }) {
  if (!data.plan || !data.profile) {
    return null;
  }
  const explanation = explainPlan(data.plan, data.profile);
  return (
    <>
      {explanation.source === 'ai' ? <Badge label="AI-generated" tone="info" /> : null}
      <Body testID="plan-explanation-text">{explanation.text}</Body>
    </>
  );
}
