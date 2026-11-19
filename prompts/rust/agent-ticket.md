Implement the ticket in `ticket.md`, with your own tests.

- The interface is drafted in `src/lib.rs`, with bodies that are
  `unimplemented!("not implemented")`. Keep its public names and
  signatures.
- The task's code lives under `src/`. Change it and add new modules there.
  The standard library only.
- Write your tests in `tests/own/main.rs`, as `#[test]` functions that
  `use task::...;`. `sh sandbox/test.sh own` runs them.
- Everything else (`sandbox/`, `Cargo.toml`) is harness, and a submission
  that changes any of it is rejected.
- Acceptance is decided by a separate run of your code against tests that
  are not in this directory; your own tests are not part of it.
- There is no network and nothing to install.

Stop when you consider the ticket implemented. End with a short summary of
what you built.
