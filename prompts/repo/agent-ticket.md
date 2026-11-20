Implement the ticket in `ticket.md` in this repository.

- The task's code lives in {{allowedPaths}}. Change it and add new files
  there. A change elsewhere is reported with the result.
- The package's existing suite, `{{test}}`, must keep passing: a test of it
  that passed before your change and fails after it rejects the submission.
- Write your own tests in `{{publicDir}}/{{ownName}}`, in the idiom
  of the existing tests ({{examples}}); `{{testOwn}}` runs them.
- Every test that existed before, `package.json`, the lockfile and the
  TypeScript and test config are harness, and a submission that changes any
  of them is rejected.
- Acceptance is decided by a separate run of your code against tests that
  are not in this repository; your own tests are not part of it.
- Nothing needs installing, and nothing may be installed.

Stop when you consider the ticket implemented, and your own tests and the
existing suite pass. End with a short summary of what you built.
