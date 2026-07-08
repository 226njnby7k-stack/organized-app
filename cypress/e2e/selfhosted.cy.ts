/// <reference types="cypress" />

/**
 * M5.5 self-hosted onboarding — end-to-end regression test.
 *
 * Exercises the full self-hosted first-run flow: passwordless login → create a
 * congregation with the self-hosted name field → master key → access code →
 * the post-creation InitialSetup prompt. This path is worth an E2E because it
 * caught a real production CORS regression (token-login is the *only* credentialed
 * call in the flow; a hardcoded Access-Control-Allow-Headers silently blocked its
 * preflight while the uncredentialed calls were fine — fixed in api commit cc2e375).
 *
 * Requires, running before this test:
 *   - API  started with SELF_HOSTED=true   (serves the static country list, no
 *     directory gate on create). Base URL from CYPRESS_API_URL / Cypress.env('apiUrl').
 *   - client built/served with VITE_SELF_HOSTED=true. URL from CYPRESS_BASE_URL / baseUrl.
 * The API must also allow the client origin (dev CORS) and be in a dev-ish mode so
 * passwordless-login returns the OTP/link in the response (MAIL disabled).
 *
 * Run: `npm run test:e2e` (optionally with CYPRESS_BASE_URL / CYPRESS_API_URL set).
 */
describe('self-hosted congregation onboarding', () => {
  const stamp = Date.now();
  const email = `selftest_${stamp}@example.com`;
  const congName = `E2E Self-Host ${stamp}`;
  const MASTER_KEY = 'SelfHostMasterKey123!'; // meets: 16+ chars, upper, lower, number, special
  const ACCESS_CODE = 'SelfHostAccessCode456#';

  const apiV3 = () => `${Cypress.env('apiUrl')}/api/v3`;
  const H = { appclient: 'organized', appversion: '4.0.0', 'Content-Type': 'application/json' };

  // Fill a MUI TextField by resolving its label's `for` to the input id.
  const typeInField = (label: string, value: string) =>
    cy.contains('label', label).invoke('attr', 'for').then((id) => cy.get(`#${id}`).type(value, { force: true }));

  it('creates a self-hosted congregation and shows the blank-fields setup prompt', () => {
    // The onboarding surfaces some benign runtime errors mid-flow; don't fail on them.
    cy.on('uncaught:exception', () => false);

    cy.intercept('POST', '**/user-passwordless-login').as('pwless');
    cy.intercept('POST', '**/verify-email-token').as('verify');
    cy.intercept('GET', '**/congregations/countries*').as('countries');
    cy.intercept('PUT', '**/api/v3/congregations').as('congCreate');

    let otp = '';

    // 1. Welcome -> Email login -> terms modal (checkbox + Next are below the fold)
    cy.visit('/', { timeout: 60000 });
    cy.contains('Welcome to Organized', { timeout: 40000 }).should('be.visible');
    cy.contains('Email login', { timeout: 10000 }).click();
    cy.contains('App functionality and data privacy', { timeout: 10000 });
    cy.get('input[type="checkbox"]').last().scrollIntoView().check({ force: true });
    cy.contains('button', 'Next').scrollIntoView().click({ force: true });

    // 2. Enter email, send passwordless link, capture the dev OTP from the response
    cy.get('input[type="text"], input:not([type])').filter(':visible').first().type(email, { force: true });
    cy.contains('button', 'Send Link').should('not.be.disabled').click();
    cy.wait('@pwless', { timeout: 20000 }).then((i) => {
      otp = String((i.response?.body as { otp?: string }).otp ?? '');
      expect(otp, 'dev OTP in passwordless response').to.match(/^\d{6}$/);
    });

    // 3. Enter the OTP.
    //    WORKAROUND: the OTP widget (mui-one-time-password-input) renders six
    //    maxLength-1 boxes. A direct cy.type(otp) only fills the first box, and a
    //    synthetic paste event doesn't reach its onPaste — in both cases React's
    //    onChange never fires with the assembled value, so verification never runs.
    //    Typing one digit at a time into cy.focused() follows the widget's own
    //    focus auto-advance and fires onChange per box, assembling the full code.
    cy.get('input').filter(':visible').should('have.length.gte', 6);
    cy.wait(500);
    cy.get('input').filter(':visible').first().click().should('be.focused');
    cy.then(() => otp.split('').forEach((d) => cy.focused().type(d, { delay: 80 })));
    cy.wait('@verify', { timeout: 20000 }).its('response.statusCode').should('eq', 200);

    // 4. Post-registration onboarding -> Create congregation (CSS uppercases the label)
    cy.contains(/create congregation/i, { timeout: 30000 }).click();

    // 5. Country picker loads the bundled static list (no external directory)
    cy.get('[role="combobox"]').filter(':visible').first().click().type('United States');
    cy.wait('@countries', { timeout: 20000 })
      .its('response.body')
      .should((arr: unknown[]) => expect(Array.isArray(arr) && arr.length).to.be.greaterThan(200));
    cy.contains('United States', { timeout: 10000 }).click();

    // 6. KEY: self-hosted mode shows a plain congregation-name TEXT FIELD, not the
    //    directory autocomplete.
    cy.contains('label', 'Congregation name', { timeout: 10000 }).should('be.visible');

    // 7. Fill required fields + approval, create (First name is empty for a new user)
    typeInField('First name', 'E2E Admin');
    typeInField('Congregation name', congName);
    cy.get('input[type="checkbox"]').last().check({ force: true }); // MUI checkbox input is visually hidden
    cy.contains('button', /create congregation/i).click();
    cy.wait('@congCreate', { timeout: 20000 }).its('response.statusCode').should('eq', 200);

    // 8. Master key + access code (client-side E2E crypto steps)
    typeInField('Create congregation master key', MASTER_KEY);
    typeInField('Confirm congregation master key', MASTER_KEY);
    cy.contains('button', 'Set master key').should('not.be.disabled').click();
    typeInField('Create congregation access code', ACCESS_CODE);
    typeInField('Confirm congregation access code', ACCESS_CODE);
    cy.contains('button', 'Set access code').should('not.be.disabled').click();

    // 9. Onboarding complete -> InitialSetup dialog: self-hosted prompt names the
    //    blank fields and embeds the editable Number/Circuit/KH-address editor.
    cy.contains('Your congregation was created with blank details', { timeout: 40000 }).should('be.visible');
    cy.contains(/kingdom hall address/i, { timeout: 10000 }).should('exist');
  });
});
