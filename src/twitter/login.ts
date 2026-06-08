import * as speakeasy from 'speakeasy';
import { getConfig } from '../config';

interface LoginFlowToken {
  flow_token: string;
  subtasks: LoginSubtask[];
}

interface LoginSubtask {
  subtask_id: string;
  enter_password?: { link: string };
  enter_text?: { link: string };
  check_logged_in_account?: { link: string };
}

const TWITTER_AUTH_BEARER = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

async function getGuestToken(): Promise<string> {
  const response = await fetch('https://api.x.com/1.1/guest/activate.json', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TWITTER_AUTH_BEARER}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get guest token: ${response.status}`);
  }

  const data = await response.json() as { guest_token: string };
  return data.guest_token;
}

async function loginRequest(
  endpoint: string,
  body: Record<string, any>,
  guestToken: string,
  cookies: Record<string, string> = {}
): Promise<{ data: LoginFlowToken; cookies: Record<string, string> }> {
  const cookieStr = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');

  const response = await fetch(`https://api.x.com${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TWITTER_AUTH_BEARER}`,
      'Content-Type': 'application/json',
      'X-Guest-Token': guestToken,
      'X-Twitter-Active-User': 'yes',
      'X-Twitter-Client-Language': 'en',
      Cookie: cookieStr,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Login request failed (${response.status}): ${text}`);
  }

  const setCookies = response.headers.getSetCookie?.() || [];
  const newCookies = { ...cookies };
  for (const cookie of setCookies) {
    const [pair] = cookie.split(';');
    const [name, value] = pair.split('=');
    if (name && value) {
      newCookies[name.trim()] = value.trim();
    }
  }

  const data = (await response.json()) as LoginFlowToken;
  return { data, cookies: newCookies };
}

function generateTOTPCode(secret: string): string {
  return speakeasy.totp({
    secret,
    encoding: 'base32',
  });
}

export interface LoginResult {
  authToken: string;
  ct0: string;
}

export async function loginWithCredentials(): Promise<LoginResult> {
  const config = getConfig();
  const { username, password, email, totpSecret } = config.twitter;

  if (!username || !password) {
    throw new Error('Username and password are required for login');
  }

  console.log(`Logging in as @${username}...`);

  const guestToken = await getGuestToken();
  let cookies: Record<string, string> = {};

  const onboardingResponse = await fetch('https://x.com/i/flow/login', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  });
  const onboardingCookies = onboardingResponse.headers.getSetCookie?.() || [];
  for (const cookie of onboardingCookies) {
    const [pair] = cookie.split(';');
    const [name, value] = pair.split('=');
    if (name && value) {
      cookies[name.trim()] = value.trim();
    }
  }

  let flowResult = await loginRequest(
    '/1.1/onboarding/task.json?flow_name=login&api_version=1&known_device_token=&sim_country_code=us',
    {
      flow_token: null,
      input_flow_data: {
        country_code: null,
        flow_context: {
          referrer_context: {
            referrer_details: {
              type_name: 'DeepLink',
              url: 'xdeeplink://onboarding/next_link',
            },
            referrer: 'onboarding',
          },
          start_location: {
            location: 'splash_screen',
          },
        },
        requested_variant: null,
        target_user_id: 0,
      },
    },
    guestToken,
    cookies
  );

  let flowToken = flowResult.data.flow_token;
  cookies = flowResult.cookies;

  flowResult = await loginRequest(
    '/1.1/onboarding/task.json',
    {
      flow_token: flowToken,
      subtask_inputs: [
        {
          subtask_id: 'LoginEnterUserIdentifier',
          enter_text: {
            suggestion_id: null,
            text: username,
            link: 'next_link',
          },
        },
      ],
    },
    guestToken,
    cookies
  );

  flowToken = flowResult.data.flow_token;
  cookies = flowResult.cookies;

  const subtasks = flowResult.data.subtasks || [];
  const subtaskIds = subtasks.map((s: LoginSubtask) => s.subtask_id);

  if (subtaskIds.includes('LoginEnterAlternateIdentifier')) {
    if (!email) {
      throw new Error('Twitter requires email verification. Please provide email in config.');
    }

    flowResult = await loginRequest(
      '/1.1/onboarding/task.json',
      {
        flow_token: flowToken,
        subtask_inputs: [
          {
            subtask_id: 'LoginEnterAlternateIdentifier',
            enter_text: {
              suggestion_id: null,
              text: email,
              link: 'next_link',
            },
          },
        ],
      },
      guestToken,
      cookies
    );

    flowToken = flowResult.data.flow_token;
    cookies = flowResult.cookies;
  }

  flowResult = await loginRequest(
    '/1.1/onboarding/task.json',
    {
      flow_token: flowToken,
      subtask_inputs: [
        {
          subtask_id: 'LoginEnterPassword',
          enter_password: {
            password,
            link: 'next_link',
          },
        },
      ],
    },
    guestToken,
    cookies
  );

  flowToken = flowResult.data.flow_token;
  cookies = flowResult.cookies;

  const postPasswordSubtasks = flowResult.data.subtasks || [];
  const postPasswordIds = postPasswordSubtasks.map((s: LoginSubtask) => s.subtask_id);

  if (postPasswordIds.includes('LoginTwoFactorAuthChallenge') || postPasswordIds.includes('LoginAcid')) {
    if (totpSecret) {
      const code = generateTOTPCode(totpSecret);
      console.log('Submitting TOTP code...');

      flowResult = await loginRequest(
        '/1.1/onboarding/task.json',
        {
          flow_token: flowToken,
          subtask_inputs: [
            {
              subtask_id: 'LoginTwoFactorAuthChallenge',
              enter_text: {
                suggestion_id: null,
                text: code,
                link: 'next_link',
              },
            },
          ],
        },
        guestToken,
        cookies
      );
    } else if (email) {
      console.log('Twitter requires verification. Please check your email for the code.');

      const readline = await import('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const code = await new Promise<string>((resolve) => {
        rl.question('Enter verification code: ', (answer) => {
          rl.close();
          resolve(answer.trim());
        });
      });

      const targetSubtask = postPasswordIds.includes('LoginAcid') ? 'LoginAcid' : 'LoginTwoFactorAuthChallenge';

      flowResult = await loginRequest(
        '/1.1/onboarding/task.json',
        {
          flow_token: flowToken,
          subtask_inputs: [
            {
              subtask_id: targetSubtask,
              enter_text: {
                suggestion_id: null,
                text: code,
                link: 'next_link',
              },
            },
          ],
        },
        guestToken,
        cookies
      );
    } else {
      throw new Error('Twitter requires 2FA. Provide totpSecret or email in config.');
    }

    flowToken = flowResult.data.flow_token;
    cookies = flowResult.cookies;
  }

  const finalSubtasks = flowResult.data.subtasks || [];
  const hasLoggedIn = finalSubtasks.some(
    (s: LoginSubtask) => s.subtask_id === 'CheckLoggedIn' || s.check_logged_in_account
  );

  if (!hasLoggedIn) {
    const ids = finalSubtasks.map((s: LoginSubtask) => s.subtask_id);
    throw new Error(`Login may have failed. Remaining subtasks: ${ids.join(', ')}`);
  }

  const authToken = cookies['auth_token'];
  const ct0 = cookies['ct0'];

  if (!authToken || !ct0) {
    throw new Error('Login completed but cookies not found in response');
  }

  console.log('Login successful!');
  console.log('\nAdd these to your config.json twitter section:');
  console.log(`  "authToken": "${authToken}"`);
  console.log(`  "ct0": "${ct0}"`);
  console.log('\nOr set environment variables:');
  console.log(`  TWITTER_AUTH_TOKEN=${authToken}`);
  console.log(`  TWITTER_CT0=${ct0}`);

  return { authToken, ct0 };
}
