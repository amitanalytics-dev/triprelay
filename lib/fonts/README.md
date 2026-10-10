# Quote fonts

Jost matches the approved brand. Noto Sans renders characters Jost lacks, including Vietnamese names. Both are bundled locally so PDF generation does not contact a font service. Their SIL Open Font licenses are included.

Sources: [Google Fonts Jost](https://github.com/google/fonts/tree/main/ofl/jost) and [static Noto Sans Regular](https://github.com/notofonts/noto-fonts/blob/main/hinted/ttf/NotoSans/NotoSans-Regular.ttf). Noto uses the static font because the variable font subset did not render correctly in inspected PDFs. The generated modules contain base64 versions of those source fonts; no credentials or customer data.
