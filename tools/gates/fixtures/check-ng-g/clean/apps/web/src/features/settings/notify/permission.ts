// 알림 허용 경로 안에서는 Notification API를 쓸 수 있다(ng-g5/push-api 허용 경로)
export const ask = () => Notification.requestPermission();
