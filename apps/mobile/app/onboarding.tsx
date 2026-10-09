import { useRouter } from 'expo-router';
import { draftFromProfile, emptyOnboardingDraft } from '../src/logic/onboarding';
import { OnboardingScreen } from '../src/screens/OnboardingScreen';
import { useStore } from '../src/state/store';
import { WithData } from '../src/state/WithData';

export default function Onboarding() {
  const store = useStore();
  const router = useRouter();
  return (
    <WithData>
      {(data) => (
        <OnboardingScreen
          initialDraft={
            data.profile ? draftFromProfile(data.profile, data.goal) : emptyOnboardingDraft()
          }
          currentYear={new Date().getFullYear()}
          timezone={data.profile?.timezone ?? store.services.timezone()}
          onSubmit={async (draft) => {
            const result = await store.completeOnboarding(draft);
            if (result.ok) {
              router.replace('/plan');
              return { ok: true };
            }
            return { ok: false, message: result.message, redFlags: result.redFlags };
          }}
        />
      )}
    </WithData>
  );
}
