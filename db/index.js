const usePostgres = !!process.env.DATABASE_URL || process.env.DB_BACKEND === 'postgres';
module.exports = usePostgres ? require('./postgres') : require('./sqlite');
