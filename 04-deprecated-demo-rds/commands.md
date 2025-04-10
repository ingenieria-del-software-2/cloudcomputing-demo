# Backup of Source Database
mysqldump -h PRIVATEIPOFMARIADBINSTANCE -u fiubawordpress -p fiubawordpress > fiubawordpress.sql


# Restore to Destination Database
mysql -h CNAMEOFRDSINSTANCE -u fiubawordpress -p fiubawordpress < fiubawordpress.sql 

# Change WP Config
cd /var/www/html
sudo nano wp-config.php

replace
/** MySQL hostname */
define('DB_HOST', 'PRIVATEIPOFMARIADBINSTANCE');

with 
/** MySQL hostname */
define('DB_HOST', 'REPLACEME_WITH_RDSINSTANCEENDPOINTADDRESS'); 