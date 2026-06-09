// Enforces Conventional Commits so semantic-release can derive the next
// version. See README "CI & releases" for the type -> release-bump table.
export default {
  extends: ["@commitlint/config-conventional"],
};
