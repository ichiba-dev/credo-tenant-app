import {
  Document,
  Font,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";

Font.register({
  family: "NotoSansJP",
  src: "/NotoSansJP-Regular.ttf",
});

type RepairPhoto = {
  photo_url: string;
  sort_order: number | null;
};

type RepairReportData = {
  property_name: string;
  room_number: string;
  tenant_name: string;
  category: string;
  description: string;
  photo_url?: string | null;
  repair_photos?: RepairPhoto[];
  status: string;
  history?: string | null;
  staff_comment?: string | null;
  created_at: string;
};

const colors = {
  navy: "#0B2E59",
  gold: "#B99452",
  ink: "#1E293B",
  muted: "#64748B",
  line: "#D9E0E8",
  soft: "#F6F8FA",
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 28,
    paddingRight: 34,
    paddingBottom: 82,
    paddingLeft: 34,
    backgroundColor: "#FFFFFF",
    fontFamily: "NotoSansJP",
    color: colors.ink,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: colors.navy,
    borderLeftWidth: 5,
    borderLeftColor: colors.gold,
    paddingVertical: 17,
    paddingHorizontal: 20,
    marginBottom: 22,
  },
  brand: {
    fontSize: 22,
    color: "#FFFFFF",
    fontWeight: "bold",
    letterSpacing: 1.5,
  },
  reportName: {
    fontSize: 10,
    color: "#DCE7F2",
    marginTop: 3,
    letterSpacing: 0.6,
  },
  reportJapaneseName: {
    fontSize: 13,
    color: "#FFFFFF",
    fontWeight: "bold",
    textAlign: "right",
  },
  reportJapaneseSubName: {
    fontSize: 8,
    color: "#DCE7F2",
    marginTop: 4,
    textAlign: "right",
  },
  section: {
    marginBottom: 18,
  },
  sectionHeading: {
    fontSize: 12,
    color: colors.navy,
    fontWeight: "bold",
    borderLeftWidth: 3,
    borderLeftColor: colors.gold,
    paddingLeft: 7,
    marginBottom: 9,
  },
  infoCard: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 3,
    overflow: "hidden",
  },
  infoRow: {
    flexDirection: "row",
    minHeight: 28,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  infoRowLast: {
    flexDirection: "row",
    minHeight: 28,
  },
  infoLabel: {
    width: "28%",
    backgroundColor: colors.soft,
    color: colors.muted,
    fontSize: 9,
    paddingVertical: 8,
    paddingHorizontal: 9,
  },
  infoValue: {
    width: "72%",
    fontSize: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  contentCard: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 3,
    padding: 13,
    backgroundColor: "#FFFFFF",
  },
  bodyText: {
    fontSize: 10,
    lineHeight: 1.8,
  },
  historyRow: {
    flexDirection: "row",
    borderLeftWidth: 2,
    borderLeftColor: colors.gold,
    paddingLeft: 8,
    marginBottom: 7,
  },
  historyBullet: {
    color: colors.gold,
    fontSize: 9,
    marginRight: 6,
  },
  historyText: {
    flex: 1,
    fontSize: 9,
    lineHeight: 1.6,
  },
  photoSection: {
    marginTop: 4,
  },
  photoBlock: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 3,
    padding: 10,
    marginBottom: 16,
  },
  photoBlockMultiple: {
    padding: 6,
    marginBottom: 8,
  },
  photoLabel: {
    fontSize: 10,
    color: colors.navy,
    fontWeight: "bold",
    marginBottom: 8,
  },
  photoLabelMultiple: {
    fontSize: 9,
    marginBottom: 5,
  },
  photo: {
    width: "100%",
    objectFit: "contain",
  },
  photoSingle: {
    height: 260,
  },
  photoMultiple: {
    height: 165,
  },
  photoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  photoGridBlock: {
    width: "48.5%",
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 3,
    padding: 7,
    marginBottom: 10,
  },
  photoGridImage: {
    width: "100%",
    height: 145,
    objectFit: "contain",
  },
  signature: {
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.gold,
    paddingTop: 12,
    alignItems: "flex-end",
  },
  signatureBrand: {
    color: colors.navy,
    fontSize: 12,
    fontWeight: "bold",
  },
  signatureText: {
    color: colors.muted,
    fontSize: 9,
    marginTop: 3,
  },
  footer: {
    position: "absolute",
    left: 34,
    right: 34,
    bottom: 24,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  footerText: {
    color: colors.muted,
    fontSize: 7.5,
    lineHeight: 1.5,
  },
  pageNumber: {
    color: colors.muted,
    fontSize: 8,
  },
});

function InformationRow({
  label,
  value,
  isLast = false,
}: {
  label: string;
  value: string;
  isLast?: boolean;
}) {
  return (
    <View style={isLast ? styles.infoRowLast : styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

export default function RepairReport({ repair }: { repair: RepairReportData }) {
  const repairPhotos = Array.isArray(repair.repair_photos)
    ? [...repair.repair_photos]
        .filter((photo) => photo?.photo_url)
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    : [];

  // repair_photos がない旧データでは、従来のphoto_urlを1枚目として利用する。
  const photos = repairPhotos.length > 0
    ? repairPhotos
    : repair.photo_url
      ? [{ photo_url: repair.photo_url, sort_order: 1 }]
      : [];

  const historyEntries = repair.history
    ? repair.history.split(/\r?\n/).filter(Boolean)
    : [];

  const photoPages: RepairPhoto[][] = [];
  if (photos.length >= 4) {
    for (let index = 0; index < photos.length; index += 6) {
      photoPages.push(photos.slice(index, index + 6));
    }
  }

  return (
    <Document>
      <Page size="A4" style={styles.page} wrap>
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>CREDO</Text>
            <Text style={styles.reportName}>Repair Report</Text>
          </View>
          <View>
            <Text style={styles.reportJapaneseName}>修繕・不具合報告書</Text>
            <Text style={styles.reportJapaneseSubName}>PROPERTY MAINTENANCE REPORT</Text>
          </View>
        </View>

        <View style={styles.section} wrap={false}>
          <Text style={styles.sectionHeading}>物件情報</Text>
          <View style={styles.infoCard}>
            <InformationRow label="物件名" value={repair.property_name} />
            <InformationRow label="部屋番号" value={repair.room_number} />
            <InformationRow label="入居者名" value={repair.tenant_name} />
            <InformationRow
              label="受付日"
              value={new Date(repair.created_at).toLocaleDateString("ja-JP")}
            />
            <InformationRow label="不具合箇所" value={repair.category} />
            <InformationRow label="ステータス" value={repair.status} isLast />
          </View>
        </View>

        <View style={styles.section} wrap={false}>
          <Text style={styles.sectionHeading}>修理内容</Text>
          <View style={styles.contentCard}>
            <Text style={styles.bodyText}>{repair.description}</Text>
          </View>
        </View>

        {repair.staff_comment && (
          <View style={styles.section} wrap={false}>
            <Text style={styles.sectionHeading}>担当者コメント</Text>
            <View style={styles.contentCard}>
              <Text style={styles.bodyText}>{repair.staff_comment}</Text>
            </View>
          </View>
        )}

        {historyEntries.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>対応履歴</Text>
            <View style={styles.contentCard}>
              {historyEntries.map((entry, index) => (
                <View key={`${index}-${entry}`} style={styles.historyRow} wrap={false}>
                  <Text style={styles.historyBullet}>●</Text>
                  <Text style={styles.historyText}>{entry}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {photos.length > 0 && photos.length < 4 && (
          <View style={styles.photoSection} break>
            <Text style={styles.sectionHeading}>写真</Text>
            {photos.map((photo, index) => (
              <View
                key={`${photo.sort_order}-${photo.photo_url}`}
                style={
                  photos.length > 1
                    ? [styles.photoBlock, styles.photoBlockMultiple]
                    : styles.photoBlock
                }
                wrap={false}
              >
                <Text
                  style={
                    photos.length > 1
                      ? [styles.photoLabel, styles.photoLabelMultiple]
                      : styles.photoLabel
                  }
                >
                  写真 {index + 1}
                </Text>
                <Image
                  src={photo.photo_url}
                  style={[
                    styles.photo,
                    photos.length === 1 ? styles.photoSingle : styles.photoMultiple,
                  ]}
                />
              </View>
            ))}
          </View>
        )}

        {photoPages.map((photoPage, pageIndex) => (
          <View
            key={`photo-page-${pageIndex}`}
            style={styles.photoSection}
            break
          >
            <Text style={styles.sectionHeading}>
              {pageIndex === 0 ? "写真" : "写真（続き）"}
            </Text>
            <View style={styles.photoGrid}>
              {photoPage.map((photo, index) => {
                const photoNumber = pageIndex * 6 + index + 1;

                return (
                  <View
                    key={`${photo.sort_order}-${photo.photo_url}`}
                    style={styles.photoGridBlock}
                    wrap={false}
                  >
                    <Text style={[styles.photoLabel, styles.photoLabelMultiple]}>
                      写真 {photoNumber}
                    </Text>
                    <Image src={photo.photo_url} style={styles.photoGridImage} />
                  </View>
                );
              })}
            </View>
          </View>
        ))}

        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            株式会社クレド{`\n`}担当：市場 雅也{`\n`}TEL：06-6427-9010
          </Text>
          <Text
            style={styles.pageNumber}
            render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  );
}
