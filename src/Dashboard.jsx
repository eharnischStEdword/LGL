import { useState, useEffect, useMemo, useCallback } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, BarChart, Bar, LabelList
} from "recharts";
// Papa removed — no longer needed since we pull directly from LGL
import * as XLSX from "xlsx";

/*
  St. Edward Church & School, Nashville TN
  Brand colors from official Style Guide (ses.stedward.org/branding):
    Green PMS 348C:  #00843D (primary), #005921 (dark)
    Gold PMS 110C:   #DAAA00 (primary), #DDCC71 (light)
    Blue PMS 2955C:  #003764 (alternate)
    Off-white:       #EEF4F1
    Font:            Mrs Eaves Roman (approximated with Georgia)
*/

const SE_GREEN = "#00843D";
const SE_GREEN_DARK = "#005921";
const SE_GOLD = "#DAAA00";
const SE_BLUE = "#003764";
const SE_OFFWHITE = "#EEF4F1";

// Historical gift data from PDS/Pushpay import (Jul 2019 – Dec 2024).
// Pre-aggregated monthly totals by fund. Keyed as fund -> "YYYY-MM" -> amount.
// These fill in months where the LGL scheduled report has no data.
const HISTORICAL_MONTHLY = {
  "Annual Fund - School Donations": {"2019-07":405,"2019-08":505,"2019-09":428,"2019-10":305,"2019-11":305,"2019-12":315,"2020-01":305,"2020-02":305,"2020-03":1035,"2020-04":330,"2020-05":2398,"2020-06":355,"2020-07":495,"2020-08":415,"2020-09":385,"2020-10":355,"2020-11":430,"2020-12":380,"2021-01":390,"2021-02":445,"2021-03":445,"2021-04":1460,"2021-05":425,"2021-06":605,"2021-07":539.43,"2021-08":970.39,"2021-09":708,"2021-10":1803,"2021-11":355,"2021-12":915,"2022-01":1070,"2022-02":380,"2022-03":730,"2022-04":482.25,"2022-05":390,"2022-06":440,"2022-07":465,"2022-08":465,"2022-09":871,"2022-10":1443.15,"2022-11":8911.84,"2022-12":2810,"2023-01":4411.58,"2023-02":3177,"2023-03":5228,"2023-04":5365.75,"2023-05":3452.25,"2023-06":12999.9,"2023-07":785,"2023-08":995,"2023-09":9247.5,"2023-10":4491.09,"2023-11":12624,"2023-12":2381,"2024-01":2765,"2024-02":1810,"2024-03":3881,"2024-04":6470.33,"2024-05":2415,"2024-06":1230.97,"2024-07":3037,"2024-08":1531,"2024-09":1248,"2024-10":10237.44,"2024-11":6619.65,"2024-12":23228.83},
  "Black & Indian Mission Collection": {"2020-01":3,"2020-02":200,"2021-01":10,"2021-02":55,"2021-03":52,"2022-02":105,"2022-03":70,"2023-02":341,"2023-06":20,"2024-02":425},
  "Building Maint. & Facility Improvement Donations": {"2023-09":10000},
  "Catholic Communication Campaign": {"2019-07":2,"2020-05":12,"2020-06":20,"2021-05":423,"2021-06":110,"2022-05":180,"2023-05":973.51,"2023-06":20,"2024-05":1213.05,"2024-12":20},
  "Catholic Home Missions Appeal": {"2023-04":301,"2024-02":901,"2024-04":1398},
  "Charity & Outreach Donations": {"2023-03":134,"2024-06":1313,"2024-12":1400},
  "Christmas": {"2021-11":23,"2021-12":4598,"2022-01":34,"2022-12":2755,"2023-01":115,"2023-12":4932,"2024-01":40,"2024-12":12126.27},
  "Collection for the Church in Latin America": {"2020-01":215,"2020-02":10,"2021-01":130,"2021-03":22,"2022-01":110.36,"2022-02":110,"2023-01":164,"2023-02":85,"2024-01":2171},
  "Diocese": {"2022-05":40,"2022-07":15,"2022-09":40,"2023-03":2500},
  "Diocese Legacy Campaign": {"2022-05":3905,"2022-06":10175,"2022-07":90,"2022-09":90,"2022-10":30,"2022-11":120,"2022-12":120,"2023-01":150,"2023-02":90,"2023-03":150,"2023-04":120,"2023-05":120,"2023-06":120,"2023-07":90,"2023-08":180,"2023-09":90,"2023-10":90,"2023-11":30},
  "Disaster Relief": {"2020-09":554},
  "Easter": {"2022-04":3775,"2022-05":20,"2023-04":3725,"2023-07":5,"2024-03":70,"2024-04":3864,"2024-06":50},
  "Fidelis": {"2019-07":50,"2019-08":50,"2019-09":50,"2019-10":50,"2019-11":50,"2019-12":50,"2020-01":50,"2020-02":50,"2020-03":50,"2020-04":50,"2020-05":50,"2020-06":50,"2020-07":50,"2020-08":50,"2020-09":50,"2020-10":50,"2020-11":50,"2020-12":50,"2021-01":50,"2021-02":50,"2021-03":50,"2021-04":50,"2021-05":50,"2021-06":50,"2021-07":50,"2021-08":1050,"2021-09":50,"2021-10":50,"2021-11":624.37,"2021-12":303,"2022-01":50,"2022-02":50,"2022-03":50,"2022-04":50,"2022-05":50,"2022-06":50,"2022-07":50,"2022-08":1050,"2022-09":50,"2022-10":50,"2022-11":50,"2022-12":50,"2023-01":50,"2023-02":50,"2023-03":50,"2023-04":50,"2023-05":105,"2023-06":105,"2023-07":105,"2023-08":1420.1,"2023-09":620,"2023-10":456.5,"2023-11":125,"2023-12":125,"2024-01":125,"2024-02":640,"2024-03":125,"2024-04":279.5,"2024-05":125,"2024-06":125,"2024-07":125,"2024-08":1125,"2024-09":125,"2024-10":125,"2024-11":125,"2024-12":105},
  "Flower Donations (Historical Giving Import)": {"2019-07":2,"2019-12":538.06,"2020-03":175,"2020-04":30,"2020-12":352,"2021-02":20,"2021-03":252,"2021-04":25,"2021-11":58,"2021-12":598,"2022-01":4,"2022-04":560,"2022-11":10,"2022-12":298,"2023-01":20,"2023-03":300,"2023-04":50,"2023-05":20,"2023-12":585,"2024-03":526.76,"2024-06":200,"2024-08":20,"2024-12":525},
  "Fr. Breen Scholarship Fund": {"2021-03":5631,"2021-04":1700,"2021-05":5250,"2021-06":5000,"2021-07":4784,"2021-08":403,"2021-10":825,"2021-11":1600,"2021-12":1103,"2022-01":304.5,"2022-02":300,"2022-04":30909.05,"2022-05":2081,"2022-06":15654.5,"2022-07":425,"2022-08":825,"2022-09":175,"2022-10":1175,"2022-11":175,"2022-12":1575,"2023-01":233,"2023-02":180,"2023-03":384.5,"2023-04":361.05,"2023-05":400,"2023-06":5150,"2023-07":150,"2023-08":150,"2023-09":150,"2023-10":150,"2023-11":1150,"2023-12":150,"2024-01":150,"2024-02":253,"2024-03":253,"2024-04":1150,"2024-05":1150,"2024-06":1150,"2024-07":1150,"2024-08":2753,"2024-09":665,"2024-10":150,"2024-11":253,"2024-12":150},
  "Fraternus": {"2019-08":475,"2019-09":285,"2019-10":1295,"2019-11":1100,"2019-12":240,"2020-04":1125,"2020-07":1000,"2020-10":517.4,"2020-12":500,"2021-01":100,"2021-03":283,"2021-07":195,"2021-08":2150,"2021-09":300,"2021-11":2080,"2021-12":600,"2022-01":600,"2022-02":850,"2022-03":50,"2022-04":830,"2022-05":415.25,"2022-06":700,"2022-07":1235,"2022-08":1050,"2022-09":50,"2022-10":50,"2022-11":2605,"2022-12":50,"2023-01":50,"2023-02":2050,"2023-03":1050,"2023-04":50,"2023-05":95,"2023-06":95,"2023-07":267.5,"2023-08":1667.59,"2023-09":520,"2023-10":2370,"2023-11":175,"2023-12":175,"2024-01":1781,"2024-02":175,"2024-03":2175,"2024-04":175,"2024-05":175,"2024-06":175,"2024-07":3402.85,"2024-08":1175,"2024-09":175,"2024-10":175,"2024-11":675,"2024-12":150},
  "Fraternus West (excursion)": {"2024-02":4220,"2024-05":300,"2024-07":375},
  "Fraternus West (members)": {"2023-05":1350,"2023-06":300,"2023-10":3650,"2024-10":300},
  "Haiti Donations": {"2019-07":432,"2019-08":397.12,"2019-09":566,"2019-10":487.12,"2019-11":400,"2019-12":686,"2020-01":559,"2020-02":491.06,"2020-03":262,"2020-04":473,"2020-05":732,"2020-06":268.16,"2020-07":265,"2020-08":510.18,"2020-09":371.06,"2020-10":415.06,"2020-11":310,"2020-12":832.2,"2021-01":462.16,"2021-02":405,"2021-03":407.08,"2021-04":423.03,"2021-05":521,"2021-06":831,"2021-07":731,"2021-08":2635,"2021-09":572.24,"2021-10":636.55,"2021-11":804,"2021-12":655,"2022-01":369.08,"2022-02":348,"2022-03":484,"2022-04":406.5,"2022-05":588,"2022-06":391,"2022-07":741,"2022-08":541,"2022-09":651.5,"2022-10":453.48,"2022-11":430,"2022-12":1020,"2023-01":540,"2023-02":555,"2023-03":410,"2023-04":534,"2023-05":810,"2023-06":705,"2023-07":521,"2023-08":745,"2023-09":565,"2023-10":575,"2023-11":715,"2023-12":830,"2024-01":375,"2024-02":515,"2024-03":911,"2024-04":538,"2024-05":381,"2024-06":499,"2024-07":492,"2024-08":801,"2024-09":453,"2024-10":983.6,"2024-11":336.5,"2024-12":865},
  "Holy Day Donations": {"2019-07":1,"2019-08":400,"2019-09":53,"2019-10":47,"2019-11":859,"2019-12":6118,"2020-01":515,"2020-02":20,"2020-03":100,"2020-08":305,"2020-10":15,"2020-11":414.26,"2020-12":7840,"2021-01":255,"2021-04":20,"2021-05":168.64,"2021-06":60,"2021-07":20.08,"2021-08":552,"2021-09":30,"2021-10":140,"2021-11":156.08,"2021-12":485,"2022-01":466,"2022-02":40,"2022-04":1320,"2022-05":85,"2022-06":125,"2022-07":20,"2022-08":316,"2022-09":23,"2022-10":200,"2022-11":589,"2022-12":957,"2023-01":640,"2023-04":2110,"2023-05":290,"2023-06":20,"2023-08":991,"2023-10":99,"2023-11":430,"2023-12":1062,"2024-01":742,"2024-02":2370.38,"2024-03":2501,"2024-04":420,"2024-05":450,"2024-06":50,"2024-07":100,"2024-08":2453,"2024-09":5,"2024-10":175,"2024-11":1590,"2024-12":2082},
  "Holy Land": {"2021-04":663,"2023-04":906,"2024-04":1060.33},
  "Knoop Scholarship (Historical Giving Import)": {"2019-10":500,"2021-09":503,"2023-09":500},
  "Memorial & Estate Donation": {"2020-07":53,"2021-11":200,"2022-01":175,"2022-02":175,"2022-03":500,"2022-04":235,"2022-05":700,"2022-08":55,"2022-09":100,"2023-02":700,"2023-09":200,"2023-10":103,"2023-12":500,"2024-05":450,"2024-09":850},
  "Offertory": {"2019-07":46295.88,"2019-08":49156.16,"2019-09":43641.21,"2019-10":59105.75,"2019-11":45491.28,"2019-12":69944.92,"2020-01":42502.17,"2020-02":44997.44,"2020-03":53311.59,"2020-04":44115.27,"2020-05":46874.86,"2020-06":28124,"2020-07":49553,"2020-08":38730.46,"2020-09":43008.25,"2020-10":50088.99,"2020-11":35184.65,"2020-12":84343.49,"2021-01":41801.01,"2021-02":47588.64,"2021-03":76321.23,"2021-04":51464.96,"2021-05":46834.85,"2021-06":51881.48,"2021-07":52339.33,"2021-08":50389.82,"2021-09":45442.39,"2021-10":72353.27,"2021-11":52868.35,"2021-12":163916.55,"2022-01":43322.47,"2022-02":58546.71,"2022-03":76843.39,"2022-04":62728.5,"2022-05":58364.36,"2022-06":59256.21,"2022-07":50033.45,"2022-08":67355,"2022-09":177200.7,"2022-10":70814.35,"2022-11":56282.3,"2022-12":76278.12,"2023-01":75081.57,"2023-02":63387.96,"2023-03":74897.3,"2023-04":80579.89,"2023-05":84495.34,"2023-06":66280.24,"2023-07":138040.58,"2023-08":100165.32,"2023-09":62110.63,"2023-10":82881.2,"2023-11":82998.31,"2023-12":174049.05,"2024-01":70327.69,"2024-02":91394.23,"2024-03":80486.79,"2024-04":88472.99,"2024-05":83267.47,"2024-06":114530.53,"2024-07":113152.63,"2024-08":119584.94,"2024-09":81658.17,"2024-10":80660.09,"2024-11":73186.23,"2024-12":110714.86},
  "Other Donations": {"2024-11":434.75},
  "Other Payments": {"2022-09":259.75,"2022-12":70,"2023-01":321.12,"2023-03":1027,"2023-04":55,"2023-05":1202,"2023-09":405.3,"2024-03":100,"2024-11":10,"2024-12":354.67},
  "Peter's Pence Collection": {"2019-07":2,"2020-05":2,"2020-06":20,"2020-07":75,"2021-06":128,"2022-06":240,"2022-07":20,"2023-05":20,"2023-06":262,"2023-07":1135.4,"2024-05":250,"2024-06":1113.57,"2024-07":101},
  "Priesthood Sunday/Seminarian Education": {"2019-10":612.21,"2019-11":90,"2021-11":758,"2023-11":729},
  "Religious Ed. & Faith Formation Donations": {"2019-07":331.8,"2019-08":134.2,"2019-09":155.06,"2019-10":117,"2019-11":64,"2019-12":119.6,"2020-01":31.16},
  "Rent": {"2019-07":200,"2019-10":975,"2019-12":1650,"2020-03":250,"2021-06":425,"2021-07":300,"2021-08":700,"2021-09":313,"2021-11":1250,"2021-12":200,"2022-01":1230,"2022-02":750,"2022-03":2325,"2022-04":1480,"2022-05":350,"2022-06":4950,"2022-07":1225,"2022-08":1600,"2022-09":2125,"2022-10":1050,"2022-11":1300,"2022-12":250,"2023-01":250,"2023-02":100,"2023-03":3450,"2023-04":1150,"2023-05":1500,"2023-08":1400,"2023-09":750,"2024-04":80,"2024-05":1180,"2024-06":800,"2024-08":75,"2024-11":250},
  "Retirement Fund for Religious": {"2019-12":122,"2020-12":302,"2021-01":20,"2021-11":3,"2021-12":320,"2022-01":23,"2022-12":340,"2023-01":20,"2023-12":2136,"2024-02":20,"2024-11":100,"2024-12":1787.42},
  "Rice Bowl": {"2020-04":449.5,"2020-06":36,"2020-09":75,"2021-04":772.27,"2021-05":161,"2021-09":109.5,"2022-04":40,"2022-05":1886.08,"2022-06":2.5,"2022-07":113,"2023-06":537.83,"2024-04":732.19,"2024-06":67.9},
  "Room In The Inn": {"2024-09":20.3,"2024-10":100,"2024-11":551.5,"2024-12":2410},
  "School - Home & School Donations": {"2022-09":6735,"2022-10":870,"2022-11":42163,"2023-02":25.75,"2023-08":2127.72,"2023-09":4479,"2023-10":2606,"2023-12":44881.38,"2024-02":159.2,"2024-03":506,"2024-04":615,"2024-08":25,"2024-09":3487,"2024-10":5697,"2024-11":500,"2024-12":48520.7},
  "School - Other": {"2019-07":32462,"2019-08":5415,"2019-09":10,"2019-10":12395.56,"2019-11":2469,"2019-12":3377.1,"2020-01":2963.88,"2020-02":757.2,"2020-03":2380,"2020-04":292.1,"2020-05":300,"2020-06":485.18,"2020-07":10755.52,"2020-08":40,"2020-09":4030.5,"2020-10":63,"2020-11":27329.5,"2020-12":3918.25,"2021-01":40,"2021-02":525,"2021-04":100,"2021-05":164.96,"2021-06":5315.82,"2021-07":2250,"2021-08":7887.66,"2021-09":339.49,"2021-10":201,"2022-12":409,"2023-03":12,"2023-05":41.6,"2023-06":978,"2023-07":800,"2023-08":15,"2023-09":179.57,"2023-10":533.79,"2023-11":504,"2024-02":7502,"2024-04":3863.35,"2024-05":855,"2024-07":2980.7,"2024-08":2926,"2024-09":323.58,"2024-10":435.62,"2024-11":441},
  "School Festival, Gala & Picnic Donation": {"2020-02":9700,"2020-03":1600,"2024-01":2000,"2024-02":1000},
  "School Festival, Gala & Picnic Payment": {"2024-02":1689,"2024-03":3475},
  "School Tuition Assistance Donation": {"2019-07":648,"2019-08":592,"2019-09":534,"2019-10":668,"2019-11":634,"2019-12":776,"2020-01":580.06,"2020-02":611,"2020-03":441,"2020-04":750,"2020-05":493,"2020-06":1585,"2020-07":872,"2020-08":643,"2020-09":701,"2020-10":624,"2020-11":645,"2020-12":715,"2021-01":620,"2021-02":543,"2021-03":961,"2021-04":1633,"2021-05":2019,"2021-06":915,"2021-07":811,"2021-08":907,"2021-09":945,"2021-10":1050,"2021-11":944,"2021-12":2360,"2022-01":783,"2022-02":920,"2022-03":3126,"2022-04":6186,"2022-05":937,"2022-06":985,"2022-07":2883,"2022-08":1121,"2022-09":1325,"2022-10":1131,"2022-11":5735.2,"2022-12":1063,"2023-01":1175,"2023-02":871,"2023-03":1205,"2023-04":1495,"2023-05":1144,"2023-06":920,"2023-07":1165,"2023-08":935,"2023-09":970,"2023-10":1142,"2023-11":982,"2023-12":1205,"2024-01":977.5,"2024-02":765,"2024-03":795,"2024-04":977,"2024-05":782.96,"2024-06":971,"2024-07":987,"2024-08":826,"2024-09":772,"2024-10":1123,"2024-11":865,"2024-12":695},
  "St. Vincent de Paul": {"2019-07":70,"2019-08":70,"2019-09":220,"2019-10":70,"2019-11":70,"2019-12":520,"2020-01":20,"2020-02":120,"2020-03":376,"2020-04":593,"2020-05":393,"2020-06":240,"2020-07":315,"2020-08":240,"2020-09":90,"2020-10":283,"2020-11":170,"2020-12":590,"2021-01":143,"2021-02":90,"2021-03":165,"2021-04":2991,"2021-05":170,"2021-06":1690,"2021-07":190,"2021-08":90,"2021-09":670,"2021-10":26998,"2021-11":150,"2021-12":450,"2022-01":450,"2022-02":350,"2022-03":425,"2022-04":350,"2022-05":350,"2022-06":453,"2022-07":350,"2022-08":400,"2022-09":350,"2022-10":330,"2022-11":300,"2022-12":680,"2023-01":150,"2023-02":260,"2023-03":420,"2023-04":495,"2023-05":790,"2023-06":382,"2023-07":290,"2023-08":410,"2023-09":300,"2023-10":250,"2023-11":353,"2023-12":1053,"2024-01":350,"2024-02":300,"2024-03":270,"2024-04":374,"2024-05":270,"2024-06":345,"2024-07":723,"2024-08":350,"2024-09":1126,"2024-10":270,"2024-11":1010,"2024-12":631},
  "Trey McCormick Memorial Fund": {"2019-07":85,"2019-08":85,"2019-09":85,"2019-10":85,"2019-11":85,"2019-12":85,"2020-01":50,"2020-02":50,"2020-03":50,"2020-04":25,"2020-05":25,"2020-06":205,"2020-07":25,"2020-08":25,"2020-09":25,"2020-10":25,"2020-11":25,"2020-12":25,"2021-01":25,"2021-02":25,"2021-03":25,"2021-04":25,"2021-05":25,"2021-06":275,"2021-07":25,"2021-08":25,"2021-09":25,"2021-10":25,"2021-11":25,"2021-12":25,"2022-01":25,"2022-02":25,"2022-03":25,"2022-04":25,"2022-05":25,"2022-06":25,"2022-07":25,"2022-08":25,"2022-09":25,"2022-10":25,"2022-11":25,"2023-03":922.2,"2023-04":125.75,"2023-05":250,"2023-06":50},
  "USCCB Collection": {"2019-10":250.06,"2019-11":425,"2020-02":5,"2020-03":127,"2020-09":20,"2020-10":177,"2020-11":135,"2020-12":5,"2021-02":10,"2021-03":187,"2021-04":20,"2021-10":163,"2021-11":171,"2021-12":35,"2022-03":282,"2022-04":40,"2022-07":5,"2022-09":5,"2022-10":272,"2022-11":270,"2022-12":20,"2023-03":415,"2023-05":1385,"2023-07":20,"2023-09":933,"2023-10":395,"2023-11":2940,"2023-12":20,"2024-03":1261.25,"2024-04":36,"2024-09":1135.18,"2024-10":1365.23,"2024-11":1392.47,"2024-12":100},
  "Vigil Lights": {"2019-07":1415.04,"2019-08":1729.75,"2019-09":1761.09,"2019-10":1209.62,"2019-11":982.16,"2019-12":1294.02,"2020-01":1143.23,"2020-02":1350.27,"2020-03":946.87,"2020-05":709,"2020-06":918,"2020-07":1802,"2020-08":1241,"2020-09":1011,"2020-10":1081,"2020-11":1551,"2020-12":781,"2021-01":1048,"2021-02":981,"2021-03":1024,"2021-04":1195.41,"2021-05":874,"2021-06":1290,"2021-07":1275.5,"2021-08":973,"2021-09":675,"2021-10":1080,"2021-11":1839,"2021-12":922,"2022-01":605,"2022-02":2020,"2022-03":976,"2022-04":644,"2022-05":1691.5,"2022-06":684,"2022-07":945,"2022-08":1052,"2022-09":876,"2022-10":1694,"2022-11":1064,"2022-12":1201,"2023-01":988,"2023-02":739,"2023-03":751,"2023-04":923,"2023-05":959,"2023-06":750,"2023-07":1109,"2023-08":743,"2023-09":933,"2023-10":1634,"2023-11":702,"2023-12":1071,"2024-02":1362,"2024-03":778,"2024-04":953.91,"2024-05":410.61,"2024-06":1214.59,"2024-07":468.65,"2024-08":848.95,"2024-09":833.6,"2024-10":531.22,"2024-11":644.1,"2024-12":446.3},
};

const FUND_COLORS = [
  SE_GREEN, SE_BLUE, "#2e8b57", "#3a7a5c", "#005921",
  "#1a6b3c", "#22763e", SE_GOLD, "#006644", "#2d7d4f",
  "#357a38", "#4a9e6e", "#1b5e20", "#4e7a4e", "#5c8a5e"
];

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const FY_START_MONTH = 7; // July
const DATA_FLOOR = new Date(2019, 6, 1); // July 1, 2019 — start of historical data

// Proxied through our server to avoid CORS issues
const LGL_OFFERTORY_ENDPOINT = "/api/lgl-data-hybrid";
const LGL_ALL_FUNDS_ENDPOINT = "/api/lgl-all-funds"; // stays on old endpoint (too large for server-side parsing)

const sans = "'Trebuchet MS', 'Calibri', sans-serif";
const serif = "'Georgia', 'Cambria', serif";

// Fiscal month labels in FY order (Jul=0 through Jun=11)
const FY_MONTH_LABELS = ["Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar","Apr","May","Jun"];

function parseSpreadsheet(arrayBuffer, contentType) {
  // If CSV/text, convert buffer to string and parse as CSV via SheetJS
  if (contentType && (contentType.includes("text/") || contentType.includes("csv"))) {
    const text = new TextDecoder("utf-8").decode(arrayBuffer);
    const wb = XLSX.read(text, { type: "string" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { defval: "" });
  }
  // Otherwise treat as xlsx binary
  const wb = XLSX.read(arrayBuffer, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: "" });
}

function parseDateFlexible(str) {
  if (!str) return null;
  // Handle Excel serial date numbers (e.g., 46093 or 46093.0)
  const num = typeof str === "number" ? str : parseFloat(str);
  if (!isNaN(num) && num > 25000 && num < 60000) {
    // Excel serial: days since 1899-12-30 (use local time, not UTC)
    // Use Math.round — CSV-parsed serials can be fractional (e.g. 45808.79)
    // and Math.floor would shift them back one day
    const d = new Date(1899, 11, 30 + Math.round(num));
    if (!isNaN(d.getTime())) return d;
  }
  const d = new Date(str);
  if (!isNaN(d.getTime())) return d;
  return null;
}

function parseAmount(val) {
  if (typeof val === "number") return val;
  if (!val) return 0;
  const cleaned = String(val).replace(/[$,\s]/g, "").replace(/\((.+)\)/, "-$1");
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

function detectColumns(headers) {
  const lower = headers.map(h => h.toLowerCase().trim());
  const datePatterns = ["gift date", "gift_date", "giftdate", "date", "deposit date", "deposit_date"];
  const amountPatterns = ["gift amount", "gift_amount", "giftamount", "amount", "gift amt", "total"];
  const fundPatterns = ["fund", "fund name", "fund_name"];

  // Prefer exact match first, then fall back to includes.
  // This avoids e.g. "Parent gift amount" matching before "Gift amount".
  function findCol(patterns) {
    for (const p of patterns) {
      const idx = lower.findIndex(h => h === p);
      if (idx !== -1) return headers[idx];
    }
    for (const p of patterns) {
      const idx = lower.findIndex(h => h.includes(p) && !h.includes("parent"));
      if (idx !== -1) return headers[idx];
    }
    return null;
  }

  return {
    dateCol: findCol(datePatterns),
    amountCol: findCol(amountPatterns),
    fundCol: findCol(fundPatterns)
  };
}

function getMonthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}`;
}

function getMonthLabel(key) {
  const [y, m] = key.split("-");
  return `${MONTHS[parseInt(m)-1]} ${y}`;
}

function getFYStart(date) {
  const y = date.getMonth() < FY_START_MONTH - 1 ? date.getFullYear() - 1 : date.getFullYear();
  return new Date(y, FY_START_MONTH - 1, 1);
}

function getFYLabel() {
  const now = new Date();
  const start = getFYStart(now);
  const endYear = start.getFullYear() + 1;
  return `FY ${start.getFullYear()}-${String(endYear).slice(2)}`;
}

// Linear regression trend line computation
// Returns { data, pct } where pct is the % change from first to last trend value
function computeTrend(data, key) {
  const points = data.map((d, i) => ({ x: i, y: d[key] || 0 }));
  const n = points.length;
  if (n < 2) return null;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (const p of points) {
    sumX += p.x; sumY += p.y; sumXY += p.x * p.y; sumXX += p.x * p.x;
  }
  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  const first = Math.max(0, intercept);
  const last = Math.max(0, intercept + slope * (n - 1));
  const pct = first > 0 ? ((last - first) / first) * 100 : 0;
  const trendData = data.map((d, i) => ({ ...d, [`${key}_trend`]: Math.max(0, intercept + slope * i) }));
  return { data: trendData, pct };
}

// Custom label for data points (used by YoY and FY Compare charts — fewer points)
const DataLabel = ({ x, y, width, value }) => {
  if (!value || value === 0) return null;
  const label = value >= 1000 ? `$${(value/1000).toFixed(1)}k` : `$${value.toFixed(0)}`;
  const cx = width != null ? x + width / 2 : x;
  return (
    <text x={cx} y={y - 12} textAnchor="middle" fill="#555" fontSize={16} fontFamily={sans}>
      {label}
    </text>
  );
};

// Collision-aware label for the standard chart (many data points)
let _smartLabelPositions = [];
function resetSmartLabels() { _smartLabelPositions = []; }
const SmartDataLabel = ({ x, y, width, value }) => {
  if (!value || value === 0) return null;
  const cx = width != null ? x + width / 2 : x;
  const cy = y - 10;
  // Check collision with already-placed labels
  for (const pos of _smartLabelPositions) {
    if (Math.abs(cx - pos.x) < 58 && Math.abs(cy - pos.y) < 20) return null;
  }
  _smartLabelPositions.push({ x: cx, y: cy });
  const label = value >= 1000 ? `$${(value/1000).toFixed(1)}k` : `$${value.toFixed(0)}`;
  return (
    <text x={cx} y={cy} textAnchor="middle" fill="#555" fontSize={12} fontFamily={sans}>
      {label}
    </text>
  );
};
// Factory for nudged labels (Recharts LabelList doesn't forward custom props)
const makeNudgedLabel = (nudge) => {
  const NudgedLabel = ({ x, y, width, value }) => {
    if (!value || value === 0) return null;
    const label = value >= 1000 ? `$${(value/1000).toFixed(1)}k` : `$${value.toFixed(0)}`;
    const cx = width != null ? x + width / 2 : x;
    return (
      <text x={cx} y={y - 12 + nudge} textAnchor="middle" fill="#555" fontSize={14} fontFamily={sans}>
        {label}
      </text>
    );
  };
  return NudgedLabel;
};
const LabelUp = makeNudgedLabel(-14);
const LabelMid = makeNudgedLabel(0);
const LabelDown = makeNudgedLabel(22);

export default function Dashboard() {
  const [rawGifts, setRawGifts] = useState([]);
  const [funds, setFunds] = useState([]);
  const [selectedFunds, setSelectedFunds] = useState(new Set());
  const [showAllFundsTotal, setShowAllFundsTotal] = useState(false);
  const [viewMode, setViewMode] = useState("chart"); // "chart" | "table"
  const [tableMode, setTableMode] = useState("fy"); // "fy" | "cy"
  const [timeRange, setTimeRange] = useState("last12");
  const [chartType, setChartType] = useState("line");
  const [useLogScale, setUseLogScale] = useState(false);
  const [colMapping, setColMapping] = useState({ dateCol: null, amountCol: null, fundCol: null });
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);
  const [fileName, setFileName] = useState(null);
  const [fetching, setFetching] = useState(null); // null | "offertory" | "allFunds"
  const [authUser, setAuthUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [fyRevenue, setFyRevenue] = useState("");
  const [fyExpenses, setFyExpenses] = useState("");
  const [fyCalced, setFyCalced] = useState(false);
  const [dataLoadedAt, setDataLoadedAt] = useState(null);

  // Check authentication status on mount
  useEffect(() => {
    fetch("/auth/status")
      .then(r => r.json())
      .then(data => {
        if (data.authenticated) {
          setAuthUser(data.user);
        }
        setAuthChecked(true);
      })
      .catch(() => setAuthChecked(true));
  }, []);

  const loadRows = useCallback((rows, sourceName) => {
    if (!rows || rows.length === 0) {
      setError("File appears empty or could not be parsed.");
      return;
    }
    const hdrs = Object.keys(rows[0]);
    setFileName(sourceName);
    const detected = detectColumns(hdrs);
    if (!detected.dateCol || !detected.amountCol || !detected.fundCol) {
      setColMapping(detected);
      setError(
        `Could not auto-detect all columns. Found: Date="${detected.dateCol || "?"}", Amount="${detected.amountCol || "?"}", Fund="${detected.fundCol || "?"}". Available columns: ${hdrs.join(", ")}`
      );
      setRawGifts(rows);
      setLoaded(false);
      return;
    }
    setColMapping(detected);
    processData(rows, detected);
  }, []);


  const fetchFromLGL = useCallback(async (offertoryOnly = false) => {
    setError(null);
    setFetching(offertoryOnly ? "offertory" : "allFunds");
    try {
      const endpoint = offertoryOnly ? LGL_OFFERTORY_ENDPOINT : LGL_ALL_FUNDS_ENDPOINT;
      const resp = await fetch(endpoint);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      const ct = resp.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        // Hybrid endpoint returns JSON
        const json = await resp.json();
        const { rows, refreshedAt, apiGiftsAdded } = json;
        const extra = apiGiftsAdded ? `, +${apiGiftsAdded} recent` : "";
        const label = `LGL - Offertory (live${extra})`;
        setDataLoadedAt(new Date(refreshedAt));
        loadRows(rows, label);
      } else {
        // Legacy endpoint returns binary spreadsheet — parse client-side
        const reportDate = resp.headers.get("x-report-date");
        const buf = await resp.arrayBuffer();
        const allRows = parseSpreadsheet(buf, ct);

        // Top up with recent gifts from API (lightweight, no server-side XLSX parsing)
        let apiGiftsAdded = 0;
        if (reportDate) {
          try {
            const apiResp = await fetch(`/api/lgl-recent-gifts?since=${reportDate}`);
            if (apiResp.ok) {
              const { gifts, refreshedAt } = await apiResp.json();
              if (gifts && gifts.length > 0) {
                // Detect columns from the spreadsheet rows
                const hdrs = Object.keys(allRows[0]);
                const cols = detectColumns(hdrs);
                if (cols.dateCol && cols.amountCol && cols.fundCol) {
                  // Normalize date to YYYY-MM-DD for consistent dedup
                  function normDate(val) {
                    if (!val) return "";
                    const num = typeof val === "number" ? val : parseFloat(val);
                    if (!isNaN(num) && num > 25000 && num < 60000) {
                      const d = new Date(1899, 11, 30 + Math.round(num));
                      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
                    }
                    const d = new Date(val);
                    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
                    return String(val).trim();
                  }
                  // Build dedup set
                  const seen = new Set();
                  for (const row of allRows) {
                    const d = normDate(row[cols.dateCol]);
                    const a = parseFloat(String(row[cols.amountCol] || "0").replace(/[$,]/g, "")) || 0;
                    const f = String(row[cols.fundCol] || "").trim().toLowerCase();
                    seen.add(`${d}|${a.toFixed(2)}|${f}`);
                  }
                  for (const g of gifts) {
                    const key = `${normDate(g.date)}|${Number(g.amount).toFixed(2)}|${(g.fund || "").toLowerCase()}`;
                    if (!seen.has(key)) {
                      const newRow = {};
                      newRow[cols.dateCol] = g.date;
                      newRow[cols.amountCol] = g.amount;
                      newRow[cols.fundCol] = g.fund;
                      allRows.push(newRow);
                      seen.add(key);
                      apiGiftsAdded++;
                    }
                  }
                }
              }
              if (refreshedAt) {
                setDataLoadedAt(new Date(refreshedAt));
              }
            }
          } catch (e) {
            // API top-up failed silently — permanent link data still loads
            console.warn("API top-up failed:", e.message);
          }
        }
        if (!dataLoadedAt) {
          if (reportDate) {
            const [y, m, d] = reportDate.split("-").map(Number);
            setDataLoadedAt(new Date(y, m - 1, d));
          } else {
            setDataLoadedAt(new Date());
          }
        }
        const extra = apiGiftsAdded ? `, +${apiGiftsAdded} recent` : "";
        const label = `LGL - All Funds (live${extra})`;
        loadRows(allRows, label);
      }
    } catch (err) {
      setError(`Could not fetch from LGL: ${err.message}`);
    } finally {
      setFetching(null);
    }
  }, [loadRows]);

  const processData = useCallback((data, mapping) => {
    const { dateCol, amountCol, fundCol } = mapping;
    if (!dateCol || !amountCol || !fundCol) return;
    const gifts = [];
    const fundSet = new Set();
    for (const row of data) {
      const date = parseDateFlexible(row[dateCol]);
      const amount = parseAmount(row[amountCol]);
      const fund = (row[fundCol] || "").trim();
      if (date && fund && date >= DATA_FLOOR) {
        gifts.push({ date, amount, fund });
        fundSet.add(fund);
      }
    }
    if (gifts.length === 0) {
      setError("No valid gift rows found. Check that date and amount columns contain recognizable data.");
      return;
    }
    // Only add historical funds that also exist in the live LGL data.
    // This prevents the Offertory-only report from showing all 42 funds.
    const sortedFunds = [...fundSet].sort();
    setRawGifts(gifts);
    setFunds(sortedFunds);
    const initial = new Set();
    const offertoryMatch = sortedFunds.find(f => f.toLowerCase().includes("offertory"));
    if (offertoryMatch) initial.add(offertoryMatch);
    else if (sortedFunds.length > 0) initial.add(sortedFunds[0]);
    setSelectedFunds(initial);
    setLoaded(true);
    setError(null);
    // dataLoadedAt is set by fetchFromLGL using LGL's Last-Modified header
  }, []);


  // Pre-computed gift index: fund|year|month → total amount
  // Turns O(n×m) loops into O(1) lookups
  // Merges hard-coded historical data for months where LGL has no data
  const giftIndex = useMemo(() => {
    const idx = {};
    const allIdx = {}; // all funds combined
    for (const g of rawGifts) {
      const yr = g.date.getFullYear();
      const mo = g.date.getMonth();
      const fk = `${g.fund}|${yr}|${mo}`;
      idx[fk] = (idx[fk] || 0) + g.amount;
      const ak = `${yr}|${mo}`;
      allIdx[ak] = (allIdx[ak] || 0) + g.amount;
    }
    // Backfill from HISTORICAL_MONTHLY where LGL data is missing
    for (const [fund, months] of Object.entries(HISTORICAL_MONTHLY)) {
      for (const [ym, amount] of Object.entries(months)) {
        const [y, m] = ym.split("-").map(Number);
        const fk = `${fund}|${y}|${m - 1}`;
        if (!idx[fk]) {
          idx[fk] = amount;
          const ak = `${y}|${m - 1}`;
          allIdx[ak] = (allIdx[ak] || 0) + amount;
        }
      }
    }
    return { byFund: idx, allFunds: allIdx };
  }, [rawGifts]);

  const filteredData = useMemo(() => {
    if (!loaded || rawGifts.length === 0 || timeRange === "yoy" || timeRange === "fyCompare") return [];
    const now = new Date();
    let startDate;
    if (timeRange === "last12") startDate = new Date(now.getFullYear() - 1, now.getMonth() + 1, 1);
    else if (timeRange === "ytd") startDate = new Date(now.getFullYear(), 0, 1);
    else if (timeRange === "fy") startDate = getFYStart(now);
    else if (timeRange === "last24") startDate = new Date(now.getFullYear() - 2, now.getMonth() + 1, 1);
    else if (timeRange === "all") startDate = new Date(DATA_FLOOR);
    else startDate = new Date(DATA_FLOOR);
    // Enforce hard floor
    if (startDate < DATA_FLOOR) startDate = new Date(DATA_FLOOR);
    const relevant = rawGifts.filter(g => g.date >= startDate && g.date <= now && selectedFunds.has(g.fund));
    const monthMap = {};
    for (const g of relevant) {
      const mk = getMonthKey(g.date);
      if (!monthMap[mk]) monthMap[mk] = {};
      if (!monthMap[mk][g.fund]) monthMap[mk][g.fund] = 0;
      monthMap[mk][g.fund] += g.amount;
    }
    // Also compute grand total across ALL funds (not just selected) for "All Funds (Total)" line
    const allFundsMonthMap = {};
    if (showAllFundsTotal) {
      const allRelevant = rawGifts.filter(g => g.date >= startDate && g.date <= now);
      for (const g of allRelevant) {
        const mk = getMonthKey(g.date);
        if (!allFundsMonthMap[mk]) allFundsMonthMap[mk] = 0;
        allFundsMonthMap[mk] += g.amount;
      }
    }
    // Backfill from HISTORICAL_MONTHLY for selected funds where live data is missing
    for (const f of selectedFunds) {
      const hist = HISTORICAL_MONTHLY[f];
      if (!hist) continue;
      for (const [ym, amount] of Object.entries(hist)) {
        const [y, m] = ym.split("-").map(Number);
        const monthDate = new Date(y, m - 1, 1);
        if (monthDate < startDate || monthDate > now) continue;
        const mk = ym;
        if (!monthMap[mk]) monthMap[mk] = {};
        if (!monthMap[mk][f]) monthMap[mk][f] = amount;
      }
    }
    // Backfill All Funds total from historical
    if (showAllFundsTotal) {
      // Build a set of fund|YYYY-MM that already have live data
      const liveFundMonths = new Set();
      for (const g of rawGifts) {
        if (g.date >= startDate && g.date <= now) {
          liveFundMonths.add(`${g.fund}|${getMonthKey(g.date)}`);
        }
      }
      for (const [fund, months] of Object.entries(HISTORICAL_MONTHLY)) {
        for (const [ym, amount] of Object.entries(months)) {
          const [y, m] = ym.split("-").map(Number);
          const monthDate = new Date(y, m - 1, 1);
          if (monthDate < startDate || monthDate > now) continue;
          if (!liveFundMonths.has(`${fund}|${ym}`)) {
            if (!allFundsMonthMap[ym]) allFundsMonthMap[ym] = 0;
            allFundsMonthMap[ym] += amount;
          }
        }
      }
    }
    const allMonths = new Set();
    let cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    while (cursor <= now) {
      allMonths.add(getMonthKey(cursor));
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return [...allMonths].sort().map(mk => {
      const row = { month: getMonthLabel(mk), _key: mk };
      for (const f of selectedFunds) row[f] = monthMap[mk]?.[f] || 0;
      if (showAllFundsTotal) row["All Funds (Total)"] = allFundsMonthMap[mk] || 0;
      return row;
    });
  }, [rawGifts, selectedFunds, timeRange, loaded, showAllFundsTotal]);

  // Add trend data to filteredData + compute trend %
  // Exclude the current (incomplete) month from trend computation so it
  // doesn't artificially drag the trendline down.
  const { chartData, trendPcts } = useMemo(() => {
    if (filteredData.length < 2) return { chartData: filteredData, trendPcts: {} };
    const now = new Date();
    const currentMonthKey = getMonthKey(now);
    // Separate completed months from the current (partial) month
    const completedData = filteredData.filter(d => d._key !== currentMonthKey);
    const currentMonth = filteredData.filter(d => d._key === currentMonthKey);
    if (completedData.length < 2) return { chartData: filteredData, trendPcts: {} };
    let result = completedData;
    const pcts = {};
    for (const f of selectedFunds) {
      const trend = computeTrend(result, f);
      if (trend) {
        result = trend.data;
        pcts[f] = trend.pct;
      }
    }
    // Append the current month back WITHOUT trend values so the main line
    // still shows it but the trendline stops at last completed month.
    return { chartData: [...result, ...currentMonth], trendPcts: pcts };
  }, [filteredData, selectedFunds]);

  const totals = useMemo(() => {
    if (!loaded) return {};
    const t = {};
    for (const f of selectedFunds) t[f] = filteredData.reduce((sum, row) => sum + (row[f] || 0), 0);
    if (showAllFundsTotal) t["All Funds (Total)"] = filteredData.reduce((sum, row) => sum + (row["All Funds (Total)"] || 0), 0);
    return t;
  }, [filteredData, selectedFunds, loaded, showAllFundsTotal]);

  // ─── YoY comparison data (calendar year: 2025 vs 2026) ───
  const yoyData = useMemo(() => {
    if (!loaded || rawGifts.length === 0 || timeRange !== "yoy") return [];
    const now = new Date();
    const calYears = [2025, 2026];
    const currentMonth = now.getMonth(); // 0-11

    const rows = MONTHS.map((label, monthIdx) => {
      // Only include months up to the current month in the current year
      if (monthIdx > currentMonth) return null;
      const row = { month: label };
      for (const yr of calYears) {
        for (const fund of selectedFunds) {
          const key = `${fund} (${yr})`;
          row[key] = giftIndex.byFund[`${fund}|${yr}|${monthIdx}`] || 0;
        }
      }
      return row;
    }).filter(Boolean);
    return rows;
  }, [giftIndex, selectedFunds, timeRange, loaded]);

  const yoySeriesKeys = useMemo(() => {
    if (timeRange !== "yoy") return [];
    const keys = [];
    for (const fund of [...selectedFunds].sort()) {
      keys.push(`${fund} (2025)`);
      keys.push(`${fund} (2026)`);
    }
    return keys;
  }, [selectedFunds, timeRange]);

  const yoyTotals = useMemo(() => {
    if (timeRange !== "yoy" || yoyData.length === 0) return {};
    const t = {};
    for (const key of yoySeriesKeys) {
      t[key] = yoyData.reduce((sum, row) => sum + (row[key] || 0), 0);
    }
    return t;
  }, [yoyData, yoySeriesKeys, timeRange]);

  // ─── FY Compare data (fiscal year: Jul–Jun, last 3 FYs) ───
  const FY_MONTHS = ["Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar","Apr","May","Jun"];

  const fyCompareData = useMemo(() => {
    if (!loaded || rawGifts.length === 0 || timeRange !== "fyCompare") return [];
    const now = new Date();
    // Determine current FY start year (FY starts in July)
    const currentFYStart = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
    // Last 3 fiscal years: e.g. FY23-24, FY24-25, FY25-26
    const fyStartYears = [currentFYStart - 2, currentFYStart - 1, currentFYStart];

    const rows = FY_MONTHS.map((label, monthIdx) => {
      // FY month index: 0=Jul(6), 1=Aug(7), ..., 5=Dec(11), 6=Jan(0), ..., 11=Jun(5)
      const calMonth = (monthIdx + 6) % 12;
      // Skip this month row entirely if even the oldest FY hasn't reached it yet
      const oldestCalYear = calMonth >= 6 ? fyStartYears[0] : fyStartYears[0] + 1;
      if (new Date(oldestCalYear, calMonth, 1) > now) return null;
      const row = { month: label };
      for (const fyStart of fyStartYears) {
        const calYear = calMonth >= 6 ? fyStart : fyStart + 1;
        const monthDate = new Date(calYear, calMonth, 1);
        const fyLabel = `FY${String(fyStart).slice(2)}-${String(fyStart + 1).slice(2)}`;
        for (const fund of selectedFunds) {
          const key = `${fund} (${fyLabel})`;
          // Skip future months but don't break — other FYs may have data
          if (monthDate > now) { row[key] = 0; continue; }
          row[key] = giftIndex.byFund[`${fund}|${calYear}|${calMonth}`] || 0;
        }
      }
      return row;
    }).filter(Boolean);
    return rows;
  }, [giftIndex, selectedFunds, timeRange, loaded]);

  const fyCompareSeriesKeys = useMemo(() => {
    if (timeRange !== "fyCompare") return [];
    const now = new Date();
    const currentFYStart = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
    const fyStartYears = [currentFYStart - 2, currentFYStart - 1, currentFYStart];
    const keys = [];
    for (const fund of [...selectedFunds].sort()) {
      for (const fyStart of fyStartYears) {
        const fyLabel = `FY${String(fyStart).slice(2)}-${String(fyStart + 1).slice(2)}`;
        keys.push(`${fund} (${fyLabel})`);
      }
    }
    return keys;
  }, [selectedFunds, timeRange]);

  // fyCompareColorMap is computed below, after fundColorMap is defined

  const fyCompareTotals = useMemo(() => {
    if (timeRange !== "fyCompare" || fyCompareData.length === 0) return {};
    const t = {};
    for (const key of fyCompareSeriesKeys) {
      t[key] = fyCompareData.reduce((sum, row) => sum + (row[key] || 0), 0);
    }
    return t;
  }, [fyCompareData, fyCompareSeriesKeys, timeRange]);

  // ─── Table view data ───
  const tableData = useMemo(() => {
    if (!loaded || rawGifts.length === 0 || viewMode !== "table") return [];
    const now = new Date();

    // Sum gift index entries for selected funds at a given year/month
    const sumSelected = (yr, mo) => {
      let total = 0;
      for (const f of selectedFunds) {
        total += giftIndex.byFund[`${f}|${yr}|${mo}`] || 0;
      }
      return total;
    };

    if (tableMode === "fy") {
      const currentFYStart = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
      const rows = [];
      for (let fyStart = currentFYStart; fyStart >= 2019; fyStart--) {
        const fyLabel = `FY${String(fyStart).slice(2)}-${String(fyStart + 1).slice(2)}`;
        const row = { label: fyLabel };
        let grandTotal = 0;
        let monthCount = 0;
        for (let mi = 0; mi < 12; mi++) {
          const calMonth = (mi + 6) % 12;
          const calYear = calMonth >= 6 ? fyStart : fyStart + 1;
          if (new Date(calYear, calMonth, 1) > now) continue;
          const monthTotal = sumSelected(calYear, calMonth);
          row[FY_MONTHS[mi]] = monthTotal;
          grandTotal += monthTotal;
          monthCount++;
        }
        row.total = grandTotal;
        row.avg = monthCount > 0 ? grandTotal / monthCount : 0;
        row.months = monthCount;
        rows.push(row);
      }
      return rows;
    } else {
      const currentYear = now.getFullYear();
      const rows = [];
      for (let yr = currentYear; yr >= 2019; yr--) {
        const row = { label: String(yr) };
        let grandTotal = 0;
        let monthCount = 0;
        for (let m = 0; m < 12; m++) {
          const monthDate = new Date(yr, m, 1);
          if (monthDate > now || monthDate < DATA_FLOOR) continue;
          const monthTotal = sumSelected(yr, m);
          row[MONTHS[m]] = monthTotal;
          grandTotal += monthTotal;
          monthCount++;
        }
        row.total = grandTotal;
        row.avg = monthCount > 0 ? grandTotal / monthCount : 0;
        row.months = monthCount;
        if (monthCount > 0) rows.push(row);
      }
      return rows;
    }
  }, [giftIndex, selectedFunds, loaded, viewMode, tableMode]);

  const toggleFund = (fund) => {
    setSelectedFunds(prev => {
      const next = new Set(prev);
      if (next.has(fund)) next.delete(fund);
      else next.add(fund);
      return next;
    });
  };

  const goHome = () => { setLoaded(false); setRawGifts([]); setFunds([]); setFileName(null); setError(null); setFyRevenue(""); setFyExpenses(""); setFyCalced(false); setDataLoadedAt(null); };
  const selectAll = () => setSelectedFunds(new Set(funds));
  const selectNone = () => setSelectedFunds(new Set());
  const fmt = (v) => v >= 1000 ? `$${(v/1000).toFixed(1)}k` : `$${v.toFixed(0)}`;
  const fmtFull = (v) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload) return null;
    // Filter out trend lines from tooltip
    const real = payload.filter(p => !p.dataKey.endsWith("_trend"));
    return (
      <div style={{
        background: SE_GREEN_DARK,
        border: `1px solid rgba(255,255,255,0.15)`,
        borderRadius: 6,
        padding: "12px 16px",
        fontSize: 16,
        color: "#fff",
        fontFamily: sans,
        boxShadow: "0 8px 24px rgba(0,0,0,0.5)"
      }}>
        <div style={{ fontWeight: 700, marginBottom: 6, color: "#fff", fontFamily: serif }}>{label}</div>
        {real.map((p, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 24, marginBottom: 3, alignItems: "center" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 6, color: "#fff" }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color, flexShrink: 0 }} />
              {p.dataKey}
            </span>
            <span style={{ fontWeight: 700, color: "#fff" }}>{fmtFull(p.value)}</span>
          </div>
        ))}
      </div>
    );
  };

  const fundColorMap = {};
  funds.forEach((f, i) => { fundColorMap[f] = FUND_COLORS[i % FUND_COLORS.length]; });

  // YoY colors — 2025 dashed, 2026 solid
  const yoyColorMap = {};
  for (const fund of funds) {
    const base = fundColorMap[fund];
    yoyColorMap[`${fund} (2025)`] = base;
    yoyColorMap[`${fund} (2026)`] = base;
  }

  // FY Compare colors — oldest gray, middle base, current base
  const fyCompareColorMap = (() => {
    const map = {};
    const now = new Date();
    const currentFYStart = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
    const fyStartYears = [currentFYStart - 2, currentFYStart - 1, currentFYStart];
    for (const fund of funds) {
      const base = fundColorMap[fund];
      for (let i = 0; i < fyStartYears.length; i++) {
        const fyLabel = `FY${String(fyStartYears[i]).slice(2)}-${String(fyStartYears[i] + 1).slice(2)}`;
        map[`${fund} (${fyLabel})`] = i === 0 ? "#999999" : base;
      }
    }
    return map;
  })();

  const ALL_FUNDS_TOTAL_KEY = "All Funds (Total)";
  const ALL_FUNDS_TOTAL_COLOR = "#333333";
  const activeFunds = [...selectedFunds].sort();
  if (showAllFundsTotal) fundColorMap[ALL_FUNDS_TOTAL_KEY] = ALL_FUNDS_TOTAL_COLOR;

  // ─── UPLOAD SCREEN ───
  if (!loaded) {
    return (
      <div style={{
        minHeight: "100vh",
        background: SE_OFFWHITE,
        fontFamily: sans,
        color: "#333",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 32
      }}>
        <div style={{ textAlign: "center", maxWidth: 600, width: "100%" }}>
          <div style={{
            width: 56, height: 56, borderRadius: "50%",
            background: SE_GREEN, display: "flex", alignItems: "center",
            justifyContent: "center", margin: "0 auto 16px",
            color: "#fff", fontSize: 26, fontFamily: serif, fontWeight: 700
          }}>
            &#10013;
          </div>

          <h1 style={{
            fontSize: 24, fontWeight: 700, color: SE_GREEN_DARK,
            margin: "0 0 2px", fontFamily: serif
          }}>
            St. Edward Church
          </h1>
          <p style={{
            color: SE_GREEN, fontSize: 16, marginBottom: 4,
            letterSpacing: "0.12em", textTransform: "uppercase",
            fontWeight: 700, fontFamily: sans
          }}>
            Fund Giving Dashboard
          </p>
          <div style={{
            width: 50, height: 2, margin: "0 auto 28px",
            background: `linear-gradient(90deg, ${SE_GREEN}, ${SE_GREEN_DARK})`
          }} />

          {/* Option 1: Offertory auto-pull */}
          <button
            onClick={() => fetchFromLGL(true)}
            disabled={!!fetching}
            style={{
              width: "100%", padding: "16px 24px",
              background: fetching === "offertory" ? "#ccc" : SE_GREEN,
              color: "#fff", border: "none", borderRadius: 10,
              fontSize: 18, fontWeight: 700, cursor: fetching ? "wait" : "pointer",
              fontFamily: serif, marginBottom: 10,
              boxShadow: "0 2px 8px rgba(0,132,61,0.25)",
              transition: "all 0.2s"
            }}
          >
            {fetching === "offertory" ? "Fetching from LGL..." : "Load Offertory Data"}
          </button>
          <p style={{ fontSize: 16, color: "#999", marginTop: 0, marginBottom: 18 }}>
            Pulls the latest Offertory giving data directly from LGL. Reports are automatically refreshed once every weekday.
          </p>

          {/* Option 2: All funds */}
          <button
            onClick={() => fetchFromLGL(false)}
            disabled={!!fetching}
            style={{
              width: "100%", padding: "14px 24px",
              background: fetching === "allFunds" ? "#eee" : "#fff",
              color: SE_GREEN_DARK, border: `2px solid ${fetching === "allFunds" ? "#ccc" : SE_GREEN}`,
              borderRadius: 10,
              fontSize: 18, fontWeight: 700, cursor: fetching ? "wait" : "pointer",
              fontFamily: serif, marginBottom: 10,
              transition: "all 0.2s"
            }}
          >
            {fetching === "allFunds" ? "Fetching from LGL..." : "Load All Funds Report"}
          </button>
          <p style={{ fontSize: 16, color: "#999", marginTop: 0, marginBottom: 20 }}>
            Pulls all fund data from LGL (Offertory, Capital Campaign, etc.)
          </p>

          {/* Error display */}
          {error && (
            <div style={{
              marginTop: 10, padding: "14px 18px",
              background: "#fef2f2", border: "1px solid #c0392b30",
              borderRadius: 8, fontSize: 16, color: "#c0392b",
              textAlign: "left", lineHeight: 1.5
            }}>
              {error}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── DASHBOARD ───
  return (
    <div style={{
      minHeight: "100vh",
      background: SE_OFFWHITE,
      fontFamily: sans,
      color: "#333",
      padding: "20px 24px"
    }}>
      {/* Header */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        marginBottom: 20, paddingBottom: 14,
        borderBottom: `2px solid ${SE_GREEN}18`, flexWrap: "wrap", gap: 10
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: "50%",
            background: SE_GREEN, display: "flex", alignItems: "center",
            justifyContent: "center", color: "#fff",
            fontSize: 17, fontFamily: serif, fontWeight: 700, flexShrink: 0
          }}>
            &#10013;
          </div>
          <div>
            <h1
              onClick={goHome}
              style={{
                fontSize: 22, fontWeight: 700, color: SE_GREEN_DARK,
                margin: 0, fontFamily: serif, lineHeight: 1.2,
                cursor: "pointer"
              }}
              title="Back to start"
            >
              St. Edward Fund Dashboard
            </h1>
            <p style={{ margin: 0, fontSize: 16, color: "#888" }}>
              {fileName} &middot; {rawGifts.length.toLocaleString()} gifts &middot; {funds.length} fund{funds.length !== 1 ? "s" : ""}
              {dataLoadedAt && (() => {
                const now = new Date();
                const diffMs = now - dataLoadedAt;
                const diffMins = Math.round(diffMs / 60000);
                let ago;
                if (diffMins < 1) ago = "just now";
                else if (diffMins < 60) ago = `${diffMins}m ago`;
                else if (diffMins < 1440) ago = `${Math.round(diffMins / 60)}h ago`;
                else {
                  const days = Math.round(diffMins / 1440);
                  ago = days === 1 ? "1 day ago" : `${days} days ago`;
                }
                const timeStr = dataLoadedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
                const dateStr = dataLoadedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                return (
                  <> &middot; Data as of {dateStr} at {timeStr} ({ago})</>
                );
              })()}
            </p>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {authUser && (
            <span style={{ fontSize: 16, color: "#888" }}>
              {authUser.name} &middot; <a href="/auth/logout" style={{ color: SE_GREEN, textDecoration: "none", fontWeight: 600 }}>Sign out</a>
            </span>
          )}
          <button
            onClick={goHome}
            style={{
              padding: "7px 16px", background: "#fff",
              border: `1px solid ${SE_GREEN}30`, borderRadius: 6,
              color: SE_GREEN_DARK, fontSize: 16, fontWeight: 600,
              cursor: "pointer"
            }}
          >
            Start Again
          </button>
        </div>
      </div>

      {/* Time + chart controls */}
      <div style={{ display: "flex", gap: 5, marginBottom: 18, flexWrap: "wrap", alignItems: "center" }}>
        {[
          { key: "fy", label: getFYLabel() },
          { key: "ytd", label: "YTD" },
          { key: "last12", label: "Last 12 Mo" },
          { key: "all", label: "All (Since Jul '19)" },
          { key: "yoy", label: "YoY Compare" },
          { key: "fyCompare", label: "FY Compare" }
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTimeRange(key)}
            style={{
              padding: "9px 18px", borderRadius: 6,
              border: timeRange === key ? `2px solid ${SE_GREEN}` : "1px solid #ccc",
              background: timeRange === key ? `${SE_GREEN}12` : "#fff",
              color: timeRange === key ? SE_GREEN_DARK : "#777",
              fontSize: 16, fontWeight: timeRange === key ? 700 : 500,
              cursor: "pointer", transition: "all 0.15s"
            }}
          >
            {label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        {["chart", "table"].map(vm => (
          <button
            key={vm}
            onClick={() => setViewMode(vm)}
            style={{
              padding: "9px 18px", borderRadius: 6,
              border: viewMode === vm ? `2px solid ${SE_BLUE}` : "1px solid #ccc",
              background: viewMode === vm ? `${SE_BLUE}12` : "#fff",
              color: viewMode === vm ? SE_BLUE : "#999",
              fontSize: 16, fontWeight: viewMode === vm ? 700 : 500,
              cursor: "pointer"
            }}
          >
            {vm === "chart" ? "Chart" : "Table"}
          </button>
        ))}
        {viewMode === "chart" && (
          <div style={{
            display: "flex", gap: 2, background: "#f0f0f0",
            borderRadius: 6, padding: 2
          }}>
            {["line", "bar"].map(t => (
              <button
                key={t}
                onClick={() => setChartType(t)}
                style={{
                  padding: "6px 14px", borderRadius: 4,
                  border: "none",
                  background: chartType === t ? "#fff" : "transparent",
                  color: chartType === t ? SE_GREEN_DARK : "#999",
                  fontSize: 14, fontWeight: chartType === t ? 700 : 500,
                  cursor: "pointer",
                  boxShadow: chartType === t ? "0 1px 3px rgba(0,0,0,0.1)" : "none"
                }}
              >
                {t === "line" ? "Line" : "Bar"}
              </button>
            ))}
          </div>
        )}
        {viewMode === "chart" && timeRange !== "yoy" && timeRange !== "fyCompare" && (
          <button
            onClick={() => setUseLogScale(prev => !prev)}
            style={{
              padding: "7px 14px", borderRadius: 6,
              border: useLogScale ? `2px solid ${SE_GOLD}` : "1px solid #ccc",
              background: useLogScale ? `${SE_GOLD}15` : "#fff",
              color: useLogScale ? SE_GREEN_DARK : "#999",
              fontSize: 14, fontWeight: useLogScale ? 700 : 500,
              cursor: "pointer"
            }}
          >
            Log
          </button>
        )}
      </div>

      {/* Totals — collapse when too many funds are selected */}
      {(activeFunds.length > 0 || showAllFundsTotal) && timeRange !== "yoy" && timeRange !== "fyCompare" && (
        <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
          {activeFunds.length <= 6 ? activeFunds.map(f => (
            <div key={f} style={{
              padding: "10px 18px", background: "#fff",
              border: `1px solid ${fundColorMap[f]}25`,
              borderLeft: `4px solid ${fundColorMap[f]}`,
              borderRadius: 6, minWidth: 150,
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)"
            }}>
              <div style={{ fontSize: 16, color: "#888", marginBottom: 3, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{f}</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: SE_GREEN_DARK, fontFamily: serif }}>
                {fmtFull(totals[f] || 0)}
              </div>
            </div>
          )) : (
            <div style={{
              padding: "10px 18px", background: "#fff",
              border: `1px solid ${SE_GREEN}25`,
              borderLeft: `4px solid ${SE_GREEN}`,
              borderRadius: 6,
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)"
            }}>
              <div style={{ fontSize: 16, color: "#888", marginBottom: 3, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{activeFunds.length} funds selected</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: SE_GREEN_DARK, fontFamily: serif }}>
                {fmtFull(activeFunds.reduce((s, f) => s + (totals[f] || 0), 0))}
              </div>
            </div>
          )}
          {showAllFundsTotal && (
            <div style={{
              padding: "10px 18px", background: "#fff",
              border: `1px solid ${ALL_FUNDS_TOTAL_COLOR}25`,
              borderLeft: `4px solid ${ALL_FUNDS_TOTAL_COLOR}`,
              borderRadius: 6, minWidth: 150,
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)"
            }}>
              <div style={{ fontSize: 16, color: "#888", marginBottom: 3, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>All Funds (Total)</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: SE_GREEN_DARK, fontFamily: serif }}>
                {fmtFull(totals[ALL_FUNDS_TOTAL_KEY] || 0)}
              </div>
            </div>
          )}
        </div>
      )}
      {/* YoY Totals */}
      {activeFunds.length > 0 && (timeRange === "yoy") && (
        <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
          {yoySeriesKeys.map(key => (
            <div key={key} style={{
              padding: "10px 18px", background: "#fff",
              border: `1px solid ${yoyColorMap[key] || SE_GREEN}25`,
              borderLeft: `4px solid ${yoyColorMap[key] || SE_GREEN}`,
              borderRadius: 6, minWidth: 150,
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)"
            }}>
              <div style={{ fontSize: 16, color: "#888", marginBottom: 3, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{key}</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: SE_GREEN_DARK, fontFamily: serif }}>
                {fmtFull(yoyTotals[key] || 0)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* FY Compare Totals */}
      {activeFunds.length > 0 && timeRange === "fyCompare" && (
        <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
          {fyCompareSeriesKeys.map(key => (
            <div key={key} style={{
              padding: "10px 18px", background: "#fff",
              border: `1px solid ${fyCompareColorMap[key] || SE_GREEN}25`,
              borderLeft: `4px solid ${fyCompareColorMap[key] || SE_GREEN}`,
              borderRadius: 6, minWidth: 150,
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)"
            }}>
              <div style={{ fontSize: 16, color: "#888", marginBottom: 3, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{key}</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: SE_GREEN_DARK, fontFamily: serif }}>
                {fmtFull(fyCompareTotals[key] || 0)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Table View */}
      {viewMode === "table" && (
        <div style={{
          background: "#fff", border: `1px solid ${SE_GREEN}12`,
          borderRadius: 8, padding: "18px 14px 10px",
          marginBottom: 18, boxShadow: "0 1px 4px rgba(0,89,33,0.04)"
        }}>
          {/* FY / CY toggle */}
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            {[{ key: "fy", label: "Fiscal Year (Jul–Jun)" }, { key: "cy", label: "Calendar Year (Jan–Dec)" }].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setTableMode(key)}
                style={{
                  padding: "7px 16px", borderRadius: 6,
                  border: tableMode === key ? `2px solid ${SE_GREEN}` : "1px solid #ccc",
                  background: tableMode === key ? `${SE_GREEN}12` : "#fff",
                  color: tableMode === key ? SE_GREEN_DARK : "#777",
                  fontSize: 15, fontWeight: tableMode === key ? 700 : 500,
                  cursor: "pointer"
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {tableData.length === 0 ? (
            <div style={{ textAlign: "center", padding: 60, color: "#aaa", fontSize: 16 }}>
              {activeFunds.length === 0 ? "Select at least one fund below." : "No data available."}
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 15, fontFamily: sans }}>
                <thead>
                  <tr style={{ borderBottom: `2px solid ${SE_GREEN}30` }}>
                    <th style={{ textAlign: "left", padding: "8px 10px", color: SE_GREEN_DARK, fontWeight: 700, position: "sticky", left: 0, background: "#fff", minWidth: 80 }}>
                      {tableMode === "fy" ? "FY" : "Year"}
                    </th>
                    {(tableMode === "fy" ? FY_MONTHS : MONTHS).map(m => (
                      <th key={m} style={{ textAlign: "right", padding: "8px 8px", color: "#666", fontWeight: 600, minWidth: 75 }}>{m}</th>
                    ))}
                    <th style={{ textAlign: "right", padding: "8px 10px", color: SE_GREEN_DARK, fontWeight: 700, minWidth: 95, borderLeft: `2px solid ${SE_GREEN}20` }}>Total</th>
                    <th style={{ textAlign: "right", padding: "8px 10px", color: SE_GREEN_DARK, fontWeight: 700, minWidth: 95 }}>Mo. Avg</th>
                  </tr>
                </thead>
                <tbody>
                  {tableData.map((row, ri) => (
                    <tr key={row.label} style={{ borderBottom: `1px solid ${SE_GREEN}10`, background: ri % 2 === 0 ? "#fafafa" : "#fff" }}>
                      <td style={{ padding: "8px 10px", fontWeight: 700, color: SE_GREEN_DARK, position: "sticky", left: 0, background: ri % 2 === 0 ? "#fafafa" : "#fff" }}>{row.label}</td>
                      {(tableMode === "fy" ? FY_MONTHS : MONTHS).map(m => (
                        <td key={m} style={{ textAlign: "right", padding: "8px 8px", color: row[m] ? "#333" : "#ccc" }}>
                          {row[m] != null ? fmtFull(row[m]) : "—"}
                        </td>
                      ))}
                      <td style={{ textAlign: "right", padding: "8px 10px", fontWeight: 700, color: SE_GREEN_DARK, borderLeft: `2px solid ${SE_GREEN}20` }}>
                        {fmtFull(row.total)}
                      </td>
                      <td style={{ textAlign: "right", padding: "8px 10px", fontWeight: 600, color: "#555" }}>
                        {fmtFull(row.avg)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Chart */}
      {viewMode === "chart" && <div style={{
        background: "#fff", border: `1px solid ${SE_GREEN}12`,
        borderRadius: 8, padding: "18px 14px 10px",
        marginBottom: 18, boxShadow: "0 1px 4px rgba(0,89,33,0.04)"
      }}>
        {(timeRange === "fyCompare") ? (
          /* ─── FY Compare Chart ─── */
          fyCompareData.length === 0 || activeFunds.length === 0 ? (
            <div style={{ textAlign: "center", padding: 60, color: "#aaa", fontSize: 16 }}>
              {activeFunds.length === 0 ? "Select at least one fund below." : "No data for FY comparison."}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={370}>
              {chartType === "line" ? (
                <LineChart data={fyCompareData} margin={{ top: 20, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={`${SE_GREEN}10`} />
                  <XAxis dataKey="month" tick={{ fill: "#888", fontSize: 16, fontFamily: sans }} axisLine={{ stroke: `${SE_GREEN}20` }} tickLine={false} />
                  <YAxis tickFormatter={fmt} tick={{ fill: "#888", fontSize: 16, fontFamily: sans }} axisLine={{ stroke: `${SE_GREEN}20` }} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 16, fontFamily: sans }} />
                  {fyCompareSeriesKeys.map(key => {
                    const parts = key.match(/\(FY(\d{2})-(\d{2})\)/);
                    const fyIdx = parts ? parseInt(parts[1]) : 0;
                    const now = new Date();
                    const currentFYStart = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
                    const currentFYShort = currentFYStart % 100;
                    const isOldest = fyIdx === (currentFYShort - 2);
                    const isMiddle = fyIdx === (currentFYShort - 1);
                    const LabelComp = isOldest ? LabelUp : isMiddle ? LabelMid : LabelDown;
                    return (
                      <Line
                        key={key}
                        type="monotone"
                        dataKey={key}
                        stroke={fyCompareColorMap[key]}
                        strokeWidth={isOldest ? 1.5 : isMiddle ? 2 : 2.5}
                        strokeDasharray={isOldest ? "3 3" : isMiddle ? "6 3" : undefined}
                        dot={{ r: isOldest ? 2 : 3, fill: fyCompareColorMap[key] }}
                        activeDot={{ r: 5 }}
                        opacity={isOldest ? 0.6 : 1}
                      >
                        <LabelList content={<LabelComp />} />
                      </Line>
                    );
                  })}
                </LineChart>
              ) : (
                <BarChart data={fyCompareData} margin={{ top: 20, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={`${SE_GREEN}10`} />
                  <XAxis dataKey="month" tick={{ fill: "#888", fontSize: 16, fontFamily: sans }} axisLine={{ stroke: `${SE_GREEN}20` }} tickLine={false} />
                  <YAxis tickFormatter={fmt} tick={{ fill: "#888", fontSize: 16, fontFamily: sans }} axisLine={{ stroke: `${SE_GREEN}20` }} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 16, fontFamily: sans }} />
                  {fyCompareSeriesKeys.map(key => {
                    const parts = key.match(/\(FY(\d{2})-(\d{2})\)/);
                    const fyIdx = parts ? parseInt(parts[1]) : 0;
                    const now = new Date();
                    const currentFYStart = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
                    const currentFYShort = currentFYStart % 100;
                    const isOldest = fyIdx === (currentFYShort - 2);
                    const isMiddle = fyIdx === (currentFYShort - 1);
                    return (
                      <Bar key={key} dataKey={key} fill={fyCompareColorMap[key]} radius={[3, 3, 0, 0]} opacity={isOldest ? 0.35 : isMiddle ? 0.5 : 0.88}>
                        <LabelList content={<DataLabel />} />
                      </Bar>
                    );
                  })}
                </BarChart>
              )}
            </ResponsiveContainer>
          )
        ) : (timeRange === "yoy") ? (
          /* ─── YoY / FY YoY Chart ─── */
          yoyData.length === 0 || activeFunds.length === 0 ? (
            <div style={{ textAlign: "center", padding: 60, color: "#aaa", fontSize: 16 }}>
              {activeFunds.length === 0 ? "Select at least one fund below." : "No data for YoY comparison."}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={370}>
              {chartType === "line" ? (
                <LineChart data={yoyData} margin={{ top: 20, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={`${SE_GREEN}10`} />
                  <XAxis dataKey="month" tick={{ fill: "#888", fontSize: 16, fontFamily: sans }} axisLine={{ stroke: `${SE_GREEN}20` }} tickLine={false} />
                  <YAxis tickFormatter={fmt} tick={{ fill: "#888", fontSize: 16, fontFamily: sans }} axisLine={{ stroke: `${SE_GREEN}20` }} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 16, fontFamily: sans }} />
                  {yoySeriesKeys.map(key => {
                    const is2025 = key.includes("(2025)");
                    const LabelComp = is2025 ? LabelUp : LabelDown;
                    return (
                      <Line
                        key={key}
                        type="monotone"
                        dataKey={key}
                        stroke={yoyColorMap[key]}
                        strokeWidth={is2025 ? 2 : 2.5}
                        strokeDasharray={is2025 ? "6 3" : undefined}
                        dot={{ r: 3, fill: yoyColorMap[key] }}
                        activeDot={{ r: 5 }}
                      >
                        <LabelList content={<LabelComp />} />
                      </Line>
                    );
                  })}
                </LineChart>
              ) : (
                <BarChart data={yoyData} margin={{ top: 20, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={`${SE_GREEN}10`} />
                  <XAxis dataKey="month" tick={{ fill: "#888", fontSize: 16, fontFamily: sans }} axisLine={{ stroke: `${SE_GREEN}20` }} tickLine={false} />
                  <YAxis tickFormatter={fmt} tick={{ fill: "#888", fontSize: 16, fontFamily: sans }} axisLine={{ stroke: `${SE_GREEN}20` }} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 16, fontFamily: sans }} />
                  {yoySeriesKeys.map(key => (
                    <Bar key={key} dataKey={key} fill={yoyColorMap[key]} radius={[3, 3, 0, 0]} opacity={key.includes("(2025)") ? 0.5 : 0.88}>
                      <LabelList content={<DataLabel />} />
                    </Bar>
                  ))}
                </BarChart>
              )}
            </ResponsiveContainer>
          )
        ) : (
          /* ─── Standard Chart ─── */
          chartData.length === 0 || (activeFunds.length === 0 && !showAllFundsTotal) ? (
            <div style={{ textAlign: "center", padding: 60, color: "#aaa", fontSize: 16 }}>
              {activeFunds.length === 0 && !showAllFundsTotal ? "Select at least one fund below." : "No data for the selected range."}
            </div>
          ) : (
            <><span style={{display:"none"}}>{(() => { resetSmartLabels(); return ""; })()}</span>
            <ResponsiveContainer width="100%" height={activeFunds.length > 8 ? 500 : 370}>
              {chartType === "line" ? (
                <LineChart data={chartData} margin={{ top: 20, right: 55, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={`${SE_GREEN}08`} horizontalFill={["#f8faf9", "transparent"]} fillOpacity={1} />
                  <XAxis dataKey="month" tick={{ fill: "#888", fontSize: 16, fontFamily: sans }} axisLine={{ stroke: `${SE_GREEN}20` }} tickLine={false} interval="preserveStartEnd" />
                  <YAxis yAxisId="left" tickFormatter={fmt} tick={{ fill: "#888", fontSize: 16, fontFamily: sans }} axisLine={{ stroke: `${SE_GREEN}20` }} tickLine={false}
                    scale={useLogScale ? "log" : "auto"} domain={useLogScale ? [100, "auto"] : [0, "auto"]} allowDataOverflow={false} />
                  <YAxis yAxisId="right" orientation="right" tickFormatter={fmt} tick={{ fill: "#aaa", fontSize: 12, fontFamily: sans }} axisLine={{ stroke: `${SE_GREEN}10` }} tickLine={false}
                    scale={useLogScale ? "log" : "auto"} domain={useLogScale ? [100, "auto"] : [0, "auto"]} allowDataOverflow={false} />
                  <Tooltip content={<CustomTooltip />} />
                  {activeFunds.length <= 8 && <Legend wrapperStyle={{ fontSize: 16, fontFamily: sans }} />}
                  {activeFunds.map(f => (
                    <Line key={f} yAxisId="left" type="monotone" dataKey={f} stroke={fundColorMap[f]} strokeWidth={2.5} dot={{ r: 3, fill: fundColorMap[f] }} activeDot={{ r: 5 }}>
                      <LabelList content={<SmartDataLabel />} />
                    </Line>
                  ))}
                  {showAllFundsTotal && (
                    <Line key={ALL_FUNDS_TOTAL_KEY} yAxisId="left" type="monotone" dataKey={ALL_FUNDS_TOTAL_KEY} stroke={ALL_FUNDS_TOTAL_COLOR} strokeWidth={3} dot={{ r: 4, fill: ALL_FUNDS_TOTAL_COLOR }} activeDot={{ r: 6 }}>
                      <LabelList content={<SmartDataLabel />} />
                    </Line>
                  )}
                  {/* Trend lines */}
                  {activeFunds.map(f => (
                    <Line
                      key={`${f}_trend`}
                      yAxisId="left"
                      type="linear"
                      dataKey={`${f}_trend`}
                      stroke={fundColorMap[f]}
                      strokeWidth={1.5}
                      strokeDasharray="8 4"
                      dot={false}
                      activeDot={false}
                      legendType="none"
                      opacity={0.5}
                    />
                  ))}
                </LineChart>
              ) : (
                <BarChart data={chartData} margin={{ top: 20, right: 55, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={`${SE_GREEN}08`} horizontalFill={["#f8faf9", "transparent"]} fillOpacity={1} />
                  <XAxis dataKey="month" tick={{ fill: "#888", fontSize: 16, fontFamily: sans }} axisLine={{ stroke: `${SE_GREEN}20` }} tickLine={false} interval="preserveStartEnd" />
                  <YAxis yAxisId="left" tickFormatter={fmt} tick={{ fill: "#888", fontSize: 16, fontFamily: sans }} axisLine={{ stroke: `${SE_GREEN}20` }} tickLine={false}
                    scale={useLogScale ? "log" : "auto"} domain={useLogScale ? [100, "auto"] : [0, "auto"]} allowDataOverflow={false} />
                  <YAxis yAxisId="right" orientation="right" tickFormatter={fmt} tick={{ fill: "#aaa", fontSize: 12, fontFamily: sans }} axisLine={{ stroke: `${SE_GREEN}10` }} tickLine={false}
                    scale={useLogScale ? "log" : "auto"} domain={useLogScale ? [100, "auto"] : [0, "auto"]} allowDataOverflow={false} />
                  <Tooltip content={<CustomTooltip />} />
                  {activeFunds.length <= 8 && <Legend wrapperStyle={{ fontSize: 16, fontFamily: sans }} />}
                  {activeFunds.map(f => (
                    <Bar key={f} yAxisId="left" dataKey={f} fill={fundColorMap[f]} radius={[3, 3, 0, 0]} opacity={0.88}>
                      <LabelList content={<SmartDataLabel />} />
                    </Bar>
                  ))}
                  {showAllFundsTotal && (
                    <Bar key={ALL_FUNDS_TOTAL_KEY} yAxisId="left" dataKey={ALL_FUNDS_TOTAL_KEY} fill={ALL_FUNDS_TOTAL_COLOR} radius={[3, 3, 0, 0]} opacity={0.88}>
                      <LabelList content={<SmartDataLabel />} />
                    </Bar>
                  )}
                </BarChart>
              )}
            </ResponsiveContainer>
            </>)
        )}
        {useLogScale && timeRange !== "yoy" && timeRange !== "fyCompare" && (
          <div style={{ textAlign: "right", padding: "4px 14px 8px", fontSize: 11, fontWeight: 700, color: SE_GOLD, letterSpacing: "0.1em", fontFamily: sans }}>
            LOGARITHMIC SCALE
          </div>
        )}
      </div>}

      {/* Trend indicator — hide when too many funds to keep it readable */}
      {viewMode === "chart" && timeRange !== "yoy" && timeRange !== "fyCompare" && activeFunds.length <= 6 && Object.keys(trendPcts).length > 0 && (
        <div style={{
          display: "flex", gap: 12, marginBottom: 14, flexWrap: "wrap"
        }}>
          {activeFunds.map(f => {
            const pct = trendPcts[f];
            if (pct == null) return null;
            const up = pct >= 0;
            const color = up ? SE_GREEN : "#c0392b";
            const arrow = up ? "▲" : "▼";
            const rangeLabel = {
              last12: "over last 12 months",
              last24: "over last 24 months",
              ytd: "year to date",
              fy: "this fiscal year",
              all: "since Jan 2025"
            }[timeRange] || "in this view";
            return (
              <div key={f} style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "6px 14px", background: `${color}08`,
                border: `1px solid ${color}20`, borderRadius: 6,
                fontSize: 16, fontFamily: sans
              }}>
                <span style={{
                  width: 10, height: 10, borderRadius: 3,
                  background: fundColorMap[f]
                }} />
                <span style={{ color: "#666" }}>{f}:</span>
                <span style={{ fontWeight: 700, color, fontSize: 18 }}>
                  {arrow} {Math.abs(pct).toFixed(1)}%
                </span>
                <span style={{ color: "#999", fontSize: 16 }}>{rangeLabel}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Fund selector */}
      <div style={{
        background: "#fff", border: `1px solid ${SE_GREEN}12`,
        borderRadius: 8, padding: "14px 18px",
        boxShadow: "0 1px 4px rgba(0,89,33,0.04)"
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <span style={{ fontSize: 18, fontWeight: 700, color: SE_GREEN_DARK, fontFamily: serif }}>Funds</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={selectAll} style={{ background: "none", border: "none", color: SE_GREEN, fontSize: 16, cursor: "pointer", fontWeight: 600 }}>All</button>
            <span style={{ color: "#ccc" }}>|</span>
            <button onClick={selectNone} style={{ background: "none", border: "none", color: SE_GREEN, fontSize: 16, cursor: "pointer", fontWeight: 600 }}>None</button>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "4px 8px" }}>
          <button
            onClick={() => setShowAllFundsTotal(prev => !prev)}
            style={{
              display: "flex", alignItems: "center", gap: 7,
              padding: "6px 10px", borderRadius: 6,
              border: showAllFundsTotal ? `2px solid ${ALL_FUNDS_TOTAL_COLOR}` : "1px solid #ddd",
              background: showAllFundsTotal ? `${ALL_FUNDS_TOTAL_COLOR}10` : "#fafafa",
              color: showAllFundsTotal ? SE_GREEN_DARK : "#999",
              fontSize: 13, fontWeight: showAllFundsTotal ? 600 : 400,
              cursor: "pointer", transition: "all 0.15s",
              gridColumn: "1 / -1", minHeight: 34
            }}
          >
            <span style={{
              width: 10, height: 10, borderRadius: 3,
              background: showAllFundsTotal ? ALL_FUNDS_TOTAL_COLOR : "#ddd",
              transition: "all 0.15s"
            }} />
            All Funds (Total)
          </button>
          {funds.map(f => {
            const active = selectedFunds.has(f);
            const color = fundColorMap[f];
            return (
              <button
                key={f}
                onClick={() => toggleFund(f)}
                title={f}
                style={{
                  display: "flex", alignItems: "flex-start", gap: 7,
                  padding: "6px 10px", borderRadius: 6,
                  border: active ? `2px solid ${color}` : "1px solid #ddd",
                  background: active ? `${color}10` : "#fafafa",
                  color: active ? SE_GREEN_DARK : "#999",
                  fontSize: 13, fontWeight: active ? 600 : 400,
                  cursor: "pointer", transition: "all 0.15s",
                  textAlign: "left", lineHeight: 1.3,
                  minHeight: 34
                }}
              >
                <span style={{
                  width: 10, height: 10, borderRadius: 3, flexShrink: 0,
                  background: active ? color : "#ddd",
                  transition: "all 0.15s",
                  marginTop: 3
                }} />
                <span style={{
                  display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical",
                  overflow: "hidden", wordBreak: "break-word"
                }}>{f}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ─── Bulletin Snapshot ─── */}
      {loaded && (() => {
        // Find the Offertory fund
        const offertoryFund = funds.find(f => f.toLowerCase().includes("offertory"));
        if (!offertoryFund) return null;

        const now = new Date();
        // Last full calendar month
        const lastMonth = now.getMonth() === 0
          ? new Date(now.getFullYear() - 1, 11, 1)
          : new Date(now.getFullYear(), now.getMonth() - 1, 1);
        // Month before that
        const prevMonth = lastMonth.getMonth() === 0
          ? new Date(lastMonth.getFullYear() - 1, 11, 1)
          : new Date(lastMonth.getFullYear(), lastMonth.getMonth() - 1, 1);
        // Same month 1 year ago
        const lastYearMonth = new Date(lastMonth.getFullYear() - 1, lastMonth.getMonth(), 1);

        function monthTotal(targetMonth, targetYear) {
          return rawGifts
            .filter(g => g.fund === offertoryFund && g.date.getMonth() === targetMonth && g.date.getFullYear() === targetYear)
            .reduce((sum, g) => sum + g.amount, 0);
        }

        const lastMonthTotal = monthTotal(lastMonth.getMonth(), lastMonth.getFullYear());
        const prevMonthTotal = monthTotal(prevMonth.getMonth(), prevMonth.getFullYear());
        const lastYearTotal = monthTotal(lastYearMonth.getMonth(), lastYearMonth.getFullYear());
        const monthDiff = lastMonthTotal - prevMonthTotal;
        const yearDiff = lastMonthTotal - lastYearTotal;

        const monthName = (d) => `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
        const diffColor = (v) => v >= 0 ? SE_GREEN : "#c0392b";
        const diffSign = (v) => v >= 0 ? "+" : "";

        return (
          <div style={{
            background: "#fff", border: `1px solid ${SE_GREEN}12`,
            borderRadius: 8, padding: "18px 22px", marginTop: 18,
            boxShadow: "0 1px 4px rgba(0,89,33,0.04)"
          }}>
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              marginBottom: 14
            }}>
              <span style={{ fontSize: 20, fontWeight: 700, color: SE_GREEN_DARK, fontFamily: serif }}>
                Financial Snapshot ({monthName(lastMonth)})
              </span>
              <span style={{
                fontSize: 16, color: "#aaa", fontStyle: "italic"
              }}>
                For parish bulletin
              </span>
            </div>

            {/* Monthly Collections */}
            <div style={{
              background: `${SE_GREEN}08`, borderRadius: 6, padding: "12px 16px",
              marginBottom: 12
            }}>
              <div style={{
                fontSize: 16, fontWeight: 700, color: SE_GREEN_DARK,
                textTransform: "uppercase", letterSpacing: "0.06em",
                marginBottom: 10, fontFamily: sans
              }}>
                Monthly Offertory Collections
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 16, fontFamily: sans }}>
                <tbody>
                  <tr>
                    <td style={{ padding: "6px 0", color: "#444" }}>{monthName(lastMonth)}</td>
                    <td style={{ padding: "6px 0", textAlign: "right", fontWeight: 700, color: SE_GREEN_DARK, fontFamily: serif, fontSize: 18 }}>
                      {fmtFull(lastMonthTotal)}
                    </td>
                  </tr>
                  <tr style={{ borderTop: "1px solid #eee" }}>
                    <td style={{ padding: "6px 0", color: "#444" }}>{monthName(prevMonth)}</td>
                    <td style={{ padding: "6px 0", textAlign: "right", fontWeight: 700, color: SE_GREEN_DARK, fontFamily: serif, fontSize: 18 }}>
                      {fmtFull(prevMonthTotal)}
                    </td>
                  </tr>
                  <tr style={{ borderTop: "1px solid #eee" }}>
                    <td style={{ padding: "6px 0", color: "#666" }}>{monthName(lastYearMonth)} <span style={{ color: "#aaa" }}>(comparison)</span></td>
                    <td style={{ padding: "6px 0", textAlign: "right", fontWeight: 700, color: SE_GREEN_DARK, fontFamily: serif, fontSize: 18 }}>
                      {lastYearTotal > 0 ? fmtFull(lastYearTotal) : <span style={{ color: "#aaa", fontWeight: 400, fontSize: 16 }}>No data</span>}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Comparisons */}
            <div style={{
              background: `${SE_GREEN}08`, borderRadius: 6, padding: "12px 16px",
              marginBottom: 12
            }}>
              <div style={{
                fontSize: 16, fontWeight: 700, color: SE_GREEN_DARK,
                textTransform: "uppercase", letterSpacing: "0.06em",
                marginBottom: 10, fontFamily: sans
              }}>
                Comparisons
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 16, fontFamily: sans }}>
                <tbody>
                  <tr>
                    <td style={{ padding: "6px 0", color: "#444" }}>
                      Month-to-month ({MONTHS[lastMonth.getMonth()]} vs {MONTHS[prevMonth.getMonth()]})
                    </td>
                    <td style={{ padding: "6px 0", textAlign: "right", fontWeight: 700, color: diffColor(monthDiff), fontFamily: serif, fontSize: 18 }}>
                      {diffSign(monthDiff)}{fmtFull(Math.abs(monthDiff))}
                    </td>
                  </tr>
                  {lastYearTotal > 0 && (
                    <tr style={{ borderTop: "1px solid #eee" }}>
                      <td style={{ padding: "6px 0", color: "#444" }}>
                        Year-over-year ({monthName(lastMonth)} vs {monthName(lastYearMonth)})
                      </td>
                      <td style={{ padding: "6px 0", textAlign: "right", fontWeight: 700, color: diffColor(yearDiff), fontFamily: serif, fontSize: 18 }}>
                        {diffSign(yearDiff)}{fmtFull(Math.abs(yearDiff))}
                        {lastYearTotal > 0 && (
                          <span style={{ fontSize: 16, fontWeight: 400, color: diffColor(yearDiff), marginLeft: 6 }}>
                            ({diffSign(yearDiff)}{((yearDiff / lastYearTotal) * 100).toFixed(1)}%)
                          </span>
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Fiscal Year to Date — manual entry */}
            <div style={{
              background: `${SE_GREEN}08`, borderRadius: 6, padding: "12px 16px",
            }}>
              <div style={{
                fontSize: 16, fontWeight: 700, color: SE_GREEN_DARK,
                textTransform: "uppercase", letterSpacing: "0.06em",
                marginBottom: 10, fontFamily: sans
              }}>
                Fiscal Year to Date
              </div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <label style={{ fontSize: 16, color: "#666", display: "block", marginBottom: 4 }}>Total Revenue</label>
                  <input
                    type="text"
                    value={fyRevenue}
                    onChange={(e) => { setFyRevenue(e.target.value); setFyCalced(false); }}
                    placeholder="e.g. 302793"
                    style={{
                      width: "100%", padding: "8px 12px", fontSize: 16,
                      border: `1px solid ${SE_GREEN}30`, borderRadius: 6,
                      fontFamily: sans, boxSizing: "border-box"
                    }}
                  />
                </div>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <label style={{ fontSize: 16, color: "#666", display: "block", marginBottom: 4 }}>Total Expenses</label>
                  <input
                    type="text"
                    value={fyExpenses}
                    onChange={(e) => { setFyExpenses(e.target.value); setFyCalced(false); }}
                    placeholder="e.g. 480576"
                    style={{
                      width: "100%", padding: "8px 12px", fontSize: 16,
                      border: `1px solid ${SE_GREEN}30`, borderRadius: 6,
                      fontFamily: sans, boxSizing: "border-box"
                    }}
                  />
                </div>
                <div style={{ display: "flex", alignItems: "flex-end" }}>
                  <button
                    onClick={() => setFyCalced(true)}
                    disabled={!fyRevenue || !fyExpenses}
                    style={{
                      padding: "8px 20px", fontSize: 16, fontWeight: 700,
                      background: (fyRevenue && fyExpenses) ? SE_GREEN : "#ccc",
                      color: "#fff", border: "none", borderRadius: 6,
                      cursor: (fyRevenue && fyExpenses) ? "pointer" : "default",
                      fontFamily: sans
                    }}
                  >
                    Calculate
                  </button>
                </div>
              </div>
              {fyCalced && (() => {
                const rev = parseAmount(fyRevenue);
                const exp = parseAmount(fyExpenses);
                const net = rev - exp;
                const netColor = net >= 0 ? SE_GREEN : "#c0392b";
                return (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 16, fontFamily: sans }}>
                    <tbody>
                      <tr>
                        <td style={{ padding: "6px 0", color: "#444" }}>Total Revenue</td>
                        <td style={{ padding: "6px 0", textAlign: "right", fontWeight: 700, color: SE_GREEN_DARK, fontFamily: serif, fontSize: 18 }}>
                          {fmtFull(rev)}
                        </td>
                      </tr>
                      <tr style={{ borderTop: "1px solid #eee" }}>
                        <td style={{ padding: "6px 0", color: "#444" }}>Total Expenses</td>
                        <td style={{ padding: "6px 0", textAlign: "right", fontWeight: 700, color: SE_GREEN_DARK, fontFamily: serif, fontSize: 18 }}>
                          {fmtFull(exp)}
                        </td>
                      </tr>
                      <tr style={{ borderTop: `2px solid ${SE_GREEN}30` }}>
                        <td style={{ padding: "8px 0", color: "#222", fontWeight: 700, fontSize: 17 }}>Net Income</td>
                        <td style={{ padding: "8px 0", textAlign: "right", fontWeight: 700, color: netColor, fontFamily: serif, fontSize: 20 }}>
                          {net < 0 ? `(${fmtFull(Math.abs(net))})` : fmtFull(net)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                );
              })()}
            </div>
          </div>
        );
      })()}

      <div style={{ marginTop: 16, fontSize: 16, color: "#aaa", textAlign: "center" }}>
        Gifts aggregated by calendar month per fund. Fiscal year begins July 1. Dashed lines show trend.
      </div>
    </div>
  );
}
