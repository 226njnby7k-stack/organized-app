/// <reference types="cypress" />

// M-recovery: client UI for MFA recovery codes. Reuses the self-hosted onboarding
// flow to reach the app, then enrolls MFA and checks the one-time codes are shown.
// Requires SELF_HOSTED=true API (dev mode -> exposes MFA_CODE) + VITE_SELF_HOSTED client.
const H = { appclient: 'organized', appversion: '4.0.0', 'Content-Type': 'application/json' };
const typeInField = (label: string, value: string) =>
  cy.contains('label', label).invoke('attr', 'for').then((id) => cy.get(`#${id}`).type(value, { force: true }));

describe('MFA recovery codes UI', () => {
  const stamp = Date.now();
  const email = `recui_${stamp}@example.com`;
  const congName = `Rec UI ${stamp}`;

  it('enrolls MFA and shows the one-time recovery codes', () => {
    cy.on('uncaught:exception', () => false);
    cy.intercept('POST', '**/user-passwordless-login').as('pwless');
    cy.intercept('GET', '**/congregations/countries*').as('countries');
    cy.intercept('PUT', '**/api/v3/congregations').as('congCreate');

    let otp = '';

    // --- onboarding (proven flow) ---
    cy.visit('/', { timeout: 60000 });
    cy.contains('Welcome to Organized', { timeout: 40000 }).should('be.visible');
    cy.contains('Email login', { timeout: 10000 }).click();
    cy.contains('App functionality and data privacy', { timeout: 10000 });
    cy.get('input[type="checkbox"]').last().scrollIntoView().check({ force: true });
    cy.contains('button', 'Next').scrollIntoView().click({ force: true });
    cy.get('input[type="text"], input:not([type])').filter(':visible').first().type(email, { force: true });
    cy.contains('button', 'Send Link').should('not.be.disabled').click();
    cy.wait('@pwless', { timeout: 20000 }).then((i) => { otp = String((i.response?.body as { otp?: string }).otp ?? ''); });
    cy.get('input').filter(':visible').should('have.length.gte', 6);
    cy.wait(500);
    cy.get('input').filter(':visible').first().click().should('be.focused');
    cy.then(() => otp.split('').forEach((d) => cy.focused().type(d, { delay: 80 })));

    cy.contains(/create congregation/i, { timeout: 30000 }).click();
    cy.get('[role="combobox"]').filter(':visible').first().click().type('United States');
    cy.wait('@countries', { timeout: 20000 });
    cy.contains('United States', { timeout: 10000 }).click();
    typeInField('First name', 'Rec Admin');
    typeInField('Congregation name', congName);
    cy.get('input[type="checkbox"]').last().check({ force: true });
    cy.contains('button', /create congregation/i).click();
    cy.wait('@congCreate', { timeout: 20000 }).its('response.statusCode').should('eq', 200);

    const MK = 'RecUIMasterKey123!';
    typeInField('Create congregation master key', MK);
    typeInField('Confirm congregation master key', MK);
    cy.contains('button', 'Set master key').should('not.be.disabled').click();
    const AC = 'RecUIAccessCode456#';
    typeInField('Create congregation access code', AC);
    typeInField('Confirm congregation access code', AC);
    cy.contains('button', 'Set access code').should('not.be.disabled').click();

    // --- reached the dashboard; clear cong_new so InitialSetup won't overlay ---
    cy.contains('Initial Organized setup', { timeout: 40000 }).should('be.visible');
    cy.window().then((win) =>
      new Cypress.Promise((resolve, reject) => {
        const open = win.indexedDB.open('organized');
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('app_settings', 'readwrite');
          const store = tx.objectStore('app_settings');
          const get = store.get(1);
          get.onsuccess = () => {
            const rec = get.result;
            rec.cong_settings = rec.cong_settings || {};
            rec.cong_settings.cong_new = false;
            const put = store.put(rec);
            put.onsuccess = () => { db.close(); resolve(null); };
            put.onerror = () => reject(put.error);
          };
          get.onerror = () => reject(get.error);
        };
        open.onerror = () => reject(open.error);
      })
    );

    // --- profile > security (hash route) ---
    cy.visit('/#/user-profile', { timeout: 60000 });
    cy.wait(8000); // re-auth via cookie + connect
    cy.contains('Two-factor authentication', { timeout: 20000 }).should('exist');

    // dismiss the "what's new" release-notes modal if it appeared
    cy.wait(2000);
    cy.get('body').then(($b) => {
      if ($b.text().includes('New Organized update')) {
        cy.contains('New Organized update').parent().find('button').first().click({ force: true });
        cy.wait(800);
      }
    });
    cy.screenshot('r02-profile', { capture: 'viewport' });

    // --- enable 2FA: the switch sits in the same container as its label ---
    cy.contains('Two-factor authentication')
      .parent()
      .parent()
      .find('input[type="checkbox"]')
      .check({ force: true });
    cy.contains(/Enter this code to continue/i, { timeout: 15000 }); // dev shows the TOTP
    cy.screenshot('r03-mfa-enable', { capture: 'viewport' });
    // grab the dev code from the dialog and type it into the OTP boxes
    cy.contains(/Enter this code to continue/i).invoke('text').then((txt) => {
      const dev = (txt.match(/(\d{6})/) || [])[1];
      // scope to the dialog's OTP widget (page inputs are behind the backdrop)
      cy.get('.MuiOtpInput-Box input').should('have.length.gte', 6);
      cy.get('.MuiOtpInput-Box input').first().click().should('be.focused');
      cy.then(() => dev.split('').forEach((d) => cy.focused().type(d, { delay: 80 })));
    });
    // enrollment requires an explicit Verify click (unlike the login OTP screen)
    cy.contains('button', /verify/i).should('not.be.disabled').click();

    // --- KEY: the one-time recovery codes are shown ---
    cy.contains('Recovery codes', { timeout: 15000 }).should('be.visible');
    cy.contains(/shown only now|save these codes/i).should('be.visible');
    cy.contains('button', /I have saved my codes/i).should('be.visible');
    // the 10 codes are the xxxx-xxxx-xxxx-xxxx hex pattern (shown only here)
    cy.get('body').invoke('text').then((txt) => {
      const codes = txt.match(/[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}/g) || [];
      expect(codes.length, 'ten recovery codes displayed').to.be.gte(10);
    });
    cy.screenshot('r04-recovery-codes', { capture: 'viewport' });

    // the settings "regenerate" row is now present (shown once MFA is enabled)
    cy.contains(/regenerate recovery codes/i).should('exist');

    cy.contains('button', /I have saved my codes/i).click();
  });
});
