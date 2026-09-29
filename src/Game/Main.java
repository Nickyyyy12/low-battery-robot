package Game;

public class Main {
    public static void main(String[] args) {
        Robot nicky = new Robot("Nicky", 100,100);
        nicky.showStatus();

        nicky.consumeBattery(20);
        nicky.showStatus();

        nicky.consumeBattery(100);
        nicky.showStatus();

        nicky.recharge(30);
        nicky.showStatus();

        nicky.recharge(100);
        nicky.showStatus();

        System.out.println(nicky.isOutOfPower());

        nicky.consumeBattery(100);
        System.out.println(nicky.isOutOfPower());

        nicky.setMaxBattery(50);
        nicky.showStatus();
    }

}
