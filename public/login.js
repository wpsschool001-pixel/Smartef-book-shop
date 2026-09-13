(() => {
  let mode = 'login'; // 'login' | 'register' | 'reset'

  const els = {
    title: document.getElementById('formTitle'),
    sub: document.getElementById('formSub'),
    form: document.getElementById('authForm'),
    submitBtn: document.getElementById('submitBtn'),
    switchPrompt: document.getElementById('switchPrompt'),
    switchBtn: document.getElementById('switchBtn'),
    forgotPrompt: document.getElementById('forgotPrompt'),
    forgotBtn: document.getElementById('forgotBtn'),
    error: document.getElementById('authError'),
    username: document.getElementById('username'),
    password: document.getElementById('password'),
    passwordLabel: document.getElementById('passwordLabel'),
    securityField: document.getElementById('securityField'),
    securityAnswer: document.getElementById('securityAnswer'),
    emailField: document.getElementById('emailField'),
    email: document.getElementById('email'),
  };

  function setMode(next) {
    mode = next;
    els.error.hidden = true;
    els.form.reset();

    if (mode === 'login') {
      els.title.textContent = 'Welcome back';
      els.sub.textContent = 'Sign in to browse the shelves.';
      els.submitBtn.textContent = 'Sign in';
      els.passwordLabel.textContent = 'Password';
      els.password.setAttribute('autocomplete', 'current-password');
      els.securityField.hidden = true;
      els.securityAnswer.required = false;
      els.emailField.hidden = true;
      els.email.required = false;
      els.switchPrompt.textContent = 'New here?';
      els.switchBtn.textContent = 'Create an account';
      els.switchBtn.hidden = false;
      els.forgotPrompt.hidden = false;
    } else if (mode === 'register') {
      els.title.textContent = 'Create your account';
      els.sub.textContent = 'Pick a username and password — at least 6 characters.';
      els.submitBtn.textContent = 'Create account';
      els.passwordLabel.textContent = 'Password';
      els.password.setAttribute('autocomplete', 'new-password');
      els.securityField.hidden = false;
      els.securityAnswer.required = true;
      els.emailField.hidden = false;
      els.email.required = true;
      els.switchPrompt.textContent = 'Already have an account?';
      els.switchBtn.textContent = 'Sign in instead';
      els.switchBtn.hidden = false;
      els.forgotPrompt.hidden = true;
    } else if (mode === 'reset') {
      els.title.textContent = 'Reset your password';
      els.sub.textContent = 'Answer your security question to set a new password.';
      els.submitBtn.textContent = 'Set new password';
      els.passwordLabel.textContent = 'New password';
      els.password.setAttribute('autocomplete', 'new-password');
      els.securityField.hidden = false;
      els.securityAnswer.required = true;
      els.emailField.hidden = true;
      els.email.required = false;
      els.switchPrompt.textContent = 'Remembered it after all?';
      els.switchBtn.textContent = 'Sign in instead';
      els.switchBtn.hidden = false;
      els.forgotPrompt.hidden = true;
    }
  }

  els.switchBtn.addEventListener('click', () => setMode(mode === 'login' ? 'register' : 'login'));
  els.forgotBtn.addEventListener('click', () => setMode('reset'));

  els.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    els.error.hidden = true;
    els.submitBtn.disabled = true;

    const username = els.username.value.trim();
    const password = els.password.value;
    const securityAnswer = els.securityAnswer.value;
    const email = els.email.value.trim();

    let endpoint, body;
    if (mode === 'login') {
      endpoint = '/api/login';
      body = { username, password };
    } else if (mode === 'register') {
      endpoint = '/api/register';
      body = { username, password, securityAnswer, email };
    } else {
      endpoint = '/api/reset-password';
      body = { username, securityAnswer, newPassword: password };
    }

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok) {
        els.error.textContent = data.error || 'Something went wrong.';
        els.error.hidden = false;
        els.submitBtn.disabled = false;
        return;
      }

      if (mode === 'reset') {
        els.sub.textContent = 'Password updated — sign in with your new password.';
        setMode('login');
        els.submitBtn.disabled = false;
        return;
      }

      window.location.href = '/';
    } catch {
      els.error.textContent = 'Could not reach the server. Check your connection and try again.';
      els.error.hidden = false;
      els.submitBtn.disabled = false;
    }
  });

  setMode('login');
})();
