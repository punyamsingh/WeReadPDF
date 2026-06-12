## [1.5.3](https://github.com/punyamsingh/WeReadPDF/compare/v1.5.2...v1.5.3) (2026-06-12)


### Bug Fixes

* keep reading position when zooming instead of jumping to section start ([eefde29](https://github.com/punyamsingh/WeReadPDF/commit/eefde29ccae242cb10130385e423140bf800fa9f))

## [1.5.2](https://github.com/punyamsingh/WeReadPDF/compare/v1.5.1...v1.5.2) (2026-06-10)


### Bug Fixes

* guard screen.orientation.lock against partial API implementations ([#36](https://github.com/punyamsingh/WeReadPDF/issues/36)) ([60cc194](https://github.com/punyamsingh/WeReadPDF/commit/60cc194dd5123e201f0eca6a752c755b92ec9be0))

## [1.5.1](https://github.com/punyamsingh/WeReadPDF/compare/v1.5.0...v1.5.1) (2026-06-10)


### Bug Fixes

* respect device rotation lock on mobile ([#35](https://github.com/punyamsingh/WeReadPDF/issues/35)) ([ad58b3c](https://github.com/punyamsingh/WeReadPDF/commit/ad58b3c99c047a89cec19791d3b948f01a4dfe51))

# [1.5.0](https://github.com/punyamsingh/WeReadPDF/compare/v1.4.0...v1.5.0) (2026-06-10)


### Bug Fixes

* clamp TOC indent and document structure helpers ([a404e7e](https://github.com/punyamsingh/WeReadPDF/commit/a404e7eb7f156ffdda5c7e704e860b9cce232df6))
* let typography and keyword chapter detectors cooperate ([02d9faf](https://github.com/punyamsingh/WeReadPDF/commit/02d9fafcaf8765467ca129267e39e21b7d11c701))


### Features

* detect document structure with a multi-source cascade ([e04e190](https://github.com/punyamsingh/WeReadPDF/commit/e04e19020a0b0243f8c156e421a3a88d1e41f2aa))

# [1.4.0](https://github.com/punyamsingh/WeReadPDF/compare/v1.3.3...v1.4.0) (2026-06-10)


### Features

* add Kindle-style pinch-to-resize text gesture ([697ea26](https://github.com/punyamsingh/WeReadPDF/commit/697ea266f24e620490e0766fb7d30b149ba758ff))

## [1.3.3](https://github.com/punyamsingh/WeReadPDF/compare/v1.3.2...v1.3.3) (2026-06-10)


### Bug Fixes

* **pwa:** regenerate app icons from branded favicon ([#32](https://github.com/punyamsingh/WeReadPDF/issues/32)) ([3f39bf0](https://github.com/punyamsingh/WeReadPDF/commit/3f39bf0e17949c25f61b7a538929633b1c60d924))

## [1.3.2](https://github.com/punyamsingh/WeReadPDF/compare/v1.3.1...v1.3.2) (2026-06-10)


### Bug Fixes

* declutter mobile nav by compacting the install button ([4304671](https://github.com/punyamsingh/WeReadPDF/commit/43046719048dd8a59398e119e4fc6f07dda5fd35))

## [1.3.1](https://github.com/punyamsingh/WeReadPDF/compare/v1.3.0...v1.3.1) (2026-06-10)


### Bug Fixes

* default to the paginated page-turn view on all devices ([b9c605e](https://github.com/punyamsingh/WeReadPDF/commit/b9c605e0a98629f68a69e9fc481f9e09d4e879b7))
* use the Mockingjay as the tab icon and tighten the tab title ([99314b4](https://github.com/punyamsingh/WeReadPDF/commit/99314b47c4ff6a11674490c453f8ead87f850ee6))

# [1.3.0](https://github.com/punyamsingh/WeReadPDF/compare/v1.2.0...v1.3.0) (2026-06-10)


### Features

* ignite the home page with rising embers and shimmer ([e268fbd](https://github.com/punyamsingh/WeReadPDF/commit/e268fbdf10f0406a74ae288a383955c1051d9110))

# [1.2.0](https://github.com/punyamsingh/WeReadPDF/compare/v1.1.0...v1.2.0) (2026-06-10)

### Bug Fixes

- address review feedback on annotations, focus trap and OCR ([63b2ff1](https://github.com/punyamsingh/WeReadPDF/commit/63b2ff118d26a6986af6daeffc02adff3330497a))

### Features

- accessibility pass — dialogs, focus, reduced motion, contrast ([6aec86c](https://github.com/punyamsingh/WeReadPDF/commit/6aec86c0de78312c0f066f6793cda620dc1b18f2)), closes [#11](https://github.com/punyamsingh/WeReadPDF/issues/11)
- bookmarks, highlights and notes with local persistence ([6ea47d7](https://github.com/punyamsingh/WeReadPDF/commit/6ea47d7d2606b5d59c850697d43bb016e2f91f11)), closes [#7](https://github.com/punyamsingh/WeReadPDF/issues/7)
- in-document full-text search with highlighting and jump-to-result ([02853a6](https://github.com/punyamsingh/WeReadPDF/commit/02853a62adb61d0b2ae17e9ba784f5fd1871c0a9)), closes [#6](https://github.com/punyamsingh/WeReadPDF/issues/6)
- layout-aware extraction for multi-column PDFs with OCR fallback ([a5de34f](https://github.com/punyamsingh/WeReadPDF/commit/a5de34f9cc0c42c98f7eeeb469ac6ac67173fe50)), closes [#10](https://github.com/punyamsingh/WeReadPDF/issues/10)
- make WeReadPDF an installable, offline-first PWA ([6745d3d](https://github.com/punyamsingh/WeReadPDF/commit/6745d3db6ce0f73ec2cd71fbbc28df97cd401de4)), closes [#12](https://github.com/punyamsingh/WeReadPDF/issues/12)
- read-aloud text-to-speech mode ([e787d4c](https://github.com/punyamsingh/WeReadPDF/commit/e787d4c3e0e1ea798e593540ec5aaf5fc468c3d3)), closes [#8](https://github.com/punyamsingh/WeReadPDF/issues/8)

# [1.1.0](https://github.com/punyamsingh/WeReadPDF/compare/v1.0.1...v1.1.0) (2026-06-09)

### Features

- add continuous scroll reading mode (closes [#4](https://github.com/punyamsingh/WeReadPDF/issues/4)) ([309d6de](https://github.com/punyamsingh/WeReadPDF/commit/309d6deaddeae4407f2ab515c8fccd28184041a4))

## [1.0.1](https://github.com/punyamsingh/WeReadPDF/compare/v1.0.0...v1.0.1) (2026-06-09)

### Performance Improvements

- window the reader by chunk so large books open instantly ([00b0e45](https://github.com/punyamsingh/WeReadPDF/commit/00b0e4524283716a26b4729b2b9cfcf587cda284))
