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
  src:"/NotoSansJP-Regular.ttf",
});

const styles = StyleSheet.create({
  page: {
    padding: 20,
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
   width: 45,
   height: 45,
   marginBottom: 10,
   },

   info: {
    fontSize: 12,
    marginBottom: 8,
   },

   sectionTitle: {
     fontSize: 14,
     fontWeight: "bold",
     marginTop: 12,
     marginBottom: 6,
   },
  
   photo: {
    width: 360,
    height: 230,
    objectFit: "cover",
    alignSelf: "center",
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
   borderWidth: 1,
   borderColor: "#CFCFCF",
   borderStyle: "solid",
   borderRadius: 4,
   padding: 12,
   marginBottom: 20,
   },

   infoTitle: {
   fontSize: 13,
   fontWeight: "bold",
   marginBottom: 10,
   },

   card: {
   borderWidth: 1,
   borderColor: "#D9D9D9",
   borderStyle: "solid",
   borderRadius: 4,
   padding: 12,
   marginBottom: 20,
   },

  cardText: {
   fontSize: 11,
   lineHeight: 18,
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

       <View style={styles.card} wrap={false}>
        
         <Text style={styles.infoTitle}>
          ■修理内容
         </Text>

         <Text style={styles.cardText}>
         {repair.description}
        </Text>

        </View>

       
        
         <Text style={styles.sectionTitle}>
          ■担当者コメント
         </Text>

        <Text style={styles.comment}>
         {repair.staff_comment || "コメントなし"}
        </Text>

      <View style={styles.row}>
        <Text style={styles.label}>
         ステータス
      </Text>

        <Text style={styles.value}>
        {repair.status}
        </Text>
     </View>  

     <View
       style={{
       marginTop: 30,
       borderTopWidth: 1,
       borderTopColor: "#CCCCCC",
       paddingTop: 12,
       alignItems: "center",
      }}
>
      <Text>株式会社クレド</Text>
      <Text>担当：市場 雅也</Text>
      <Text>TEL：06-6427-9010</Text>
     </View>

      {repair.photo_url && (
         <>  
       

       <Text style={styles.photoTitle}>
          現場写真
       </Text>

       <Image
         src={repair.photo_url}
         style={styles.photo}
       />
      </>
       )}

       

      

      </Page>
    </Document>
  );
}