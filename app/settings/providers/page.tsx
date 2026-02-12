import { redirect } from 'next/navigation';

/**
 * Redirect legacy /settings/providers to unified /settings
 */
export default function SettingsProvidersRedirect() {
  redirect('/settings');
}
