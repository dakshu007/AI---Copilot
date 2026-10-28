import { useEffect, useState } from 'react';
import type { CandidateProfile, JobContext } from '@shared/types';
import { useCopilot } from '../app/CopilotProvider';
import { JobDescriptionEditor } from '../components/JobDescriptionEditor';
import { ResumeProfileEditor } from '../components/ResumeProfileEditor';
import { api, errorMessage, unwrap } from '../lib/api';

export function ProfilePage() {
  const { notify } = useCopilot();
  const [profile, setProfile] = useState<CandidateProfile | null>(null);
  const [job, setJob] = useState<JobContext | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([unwrap(api().profile.get()), unwrap(api().job.get())])
      .then(([p, j]) => {
        setProfile(p);
        setJob(j);
      })
      .catch((error) => notify('error', errorMessage(error)))
      .finally(() => setLoaded(true));
  }, [notify]);

  if (!loaded) return null;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-10 overflow-y-auto pb-10">
      <ResumeProfileEditor
        profile={profile}
        onImportFile={() => unwrap(api().profile.importFile())}
        onImportBytes={(name, bytes) => unwrap(api().profile.importBytes(name, bytes))}
        onExtractText={(text) => unwrap(api().profile.extractFromText(text))}
        onSave={async (next) => {
          setProfile(await unwrap(api().profile.save(next)));
          notify('info', next.verified ? 'Profile confirmed and saved.' : 'Draft saved. Confirm it to use it in answers.');
        }}
        onDelete={async () => {
          await unwrap(api().profile.delete());
          setProfile(null);
        }}
      />
      <JobDescriptionEditor
        job={job}
        onAnalyze={(text) => unwrap(api().job.analyze(text))}
        onSave={async (next) => setJob(await unwrap(api().job.save(next)))}
        onDelete={async () => {
          await unwrap(api().job.delete());
          setJob(null);
        }}
      />
    </div>
  );
}
