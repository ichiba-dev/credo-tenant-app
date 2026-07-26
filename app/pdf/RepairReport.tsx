import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Image,
  Font,
} from "@react-pdf/renderer";

 Font.register({
  family: "NotoSansJP",
  src: window.location.origin + "/NotoSansJP-Regular.ttf",
});

const styles = StyleSheet.create({
  page: {
    padding: 30,
    backgroundColor: "#ffffff",
    fontFamily: "NotoSansJP",
  },

   header: {
    backgroundColor: "#0B2E59",
    padding: 20,
    alignItems: "center",
    marginBottom: 20,
   },

   title: {
    fontSize: 22,
    color: "#FFFFFF",
    fontWeight: "bold",
   },

   subTitle: {
   fontSize: 15,
   color: "#FFFFFF",
   marginTop: 4,
   },

   jpTitle: {
   fontSize: 10,
   color: "#FFFFFF",
   marginTop: 2,
   },

   row: {
   flexDirection: "row",
   marginBottom: 8,
   },

   label: {
   width: 80,
   fontWeight: "bold",
   },

   value: {
   flex: 1,
   },

   logo: {
   width: 40,
   height: 40,
   marginBottom: 10,
   },

   info: {
    fontSize: 12,
    marginBottom: 8,
   },

   sectionTitle: {
     fontSize: 14,
     fontWeight: "bold",
     marginTop: 20,
     marginBottom: 10,
   },
   photo: {
   width: 300,
   height: 200,
   objectFit: "cover",
   },

   photoTitle: {
   fontSize: 14,
   fontWeight: "bold",
   marginTop: 20,
   marginBottom: 10,
   },

   section: {
   marginTop: 20,
   },

   comment: {
   fontSize: 11,
   lineHeight: 20,
   },
  

   infoBox: {
   border: "1 solid #CFCFCF",
   padding: 12,
   marginBottom: 20,
   },

   infoTitle: {
   fontSize: 13,
   fontWeight: "bold",
   marginBottom: 10,
   },
   });

export default function RepairReport({ repair }: any) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>

        <View style={styles.header}>
         <Image
           src="/credo-logo.png"
           style={styles.logo}
         />

       <Text style={styles.title}>
        CREDO
      </Text>

      <Text style={styles.subTitle}>
      Repair Report
     </Text>

      <Text style={styles.jpTitle}>
       修繕・不具合報告書
     </Text>
       </View>

      <View style={styles.infoBox}>
        <Text style={styles.infoTitle}>
        ■物件情報
      </Text>

      <View style={styles.row}>
        <Text style={styles.label}>物件名</Text>
        <Text style={styles.value}>
        {repair.property_name}
        </Text>
      </View>

      <View style={styles.row}>
       <Text style={styles.label}>部屋番号</Text>
       <Text style={styles.value}>
       {repair.room_number}
       </Text>
      </View>

     <View style={styles.row}>
      <Text style={styles.label}>入居者名</Text>
      <Text style={styles.value}>
      {repair.tenant_name}
     </Text>
     </View>

     <View style={styles.row}>
       <Text style={styles.label}>受付日</Text>
       <Text style={styles.value}>
        {new Date(repair.created_at).toLocaleDateString("ja-JP")}
       </Text>
      </View>

  </View>

       <Text style={styles.sectionTitle}>
        修理内容
       </Text>

       <Text style={styles.info}>
         {repair.description}
       </Text>

       {repair.photo_url && (
         <>
        <View style={styles.section}>
         <Text style={styles.sectionTitle}>
          担当者コメント
         </Text>

        <Text style={styles.comment}>
         {repair.staff_comment || "コメントなし"}
        </Text>
       </View>

       <Text style={styles.photoTitle}>
          現場写真
       </Text>

       <Image
         src={repair.photo_url}
         style={styles.photo}
       />
      </>
       )}

       

      <View style={styles.row}>
        <Text style={styles.label}>
         ステータス
      </Text>

        <Text style={styles.value}>
        {repair.status}
        </Text>
     </View>

      </Page>
    </Document>
  );
}